/**
 * Verifica contra DynamoDB Local la semántica real de la reserva de idempotencia y de la auditoría.
 * Se omite si no hay `DYNAMODB_LOCAL_ENDPOINT` (p. ej. http://localhost:8000); nunca usa AWS.
 */
import { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { auditPutItem, buildAuditEvent } from "../../src/audit/repository";
import { cancellationCodes, failedConditionAt } from "../../src/shared/dynamodb";
import {
  buildIdempotencyPk,
  buildIdempotencyRecord,
  decideIdempotency,
  idempotencyPutItem,
  type IdempotencyRecord,
} from "../../src/shared/idempotency";
import {
  DONOR_A_SUB,
  IDEMPOTENCY_KEY_1,
  makeDonation,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { createLocalClients, hasLocalDynamo, resetTables, testConfig } from "../helpers/setup";

const config = testConfig();
const payload = { projectId: PUBLISHED_PROJECT_ID, amountCents: 500 };

describe.skipIf(!hasLocalDynamo())("DynamoDB Local: idempotencia atómica y auditoría", () => {
  const { raw, doc } = hasLocalDynamo()
    ? createLocalClients()
    : ({} as ReturnType<typeof createLocalClients>);

  beforeAll(async () => {
    await resetTables(raw, config);
  });

  const createDonationTransaction = (donationId: string, record: IdempotencyRecord) =>
    doc.send(
      new TransactWriteCommand({
        TransactItems: [
          idempotencyPutItem(config.tables.idempotency, record),
          {
            Put: {
              TableName: config.tables.donations,
              Item: makeDonation({ donationId }),
              ConditionExpression: "attribute_not_exists(donationId)",
            },
          },
          auditPutItem(
            config.tables.audit,
            buildAuditEvent({
              eventType: "DONATION_CREATED",
              requestId: "req",
              actorSub: DONOR_A_SUB,
              action: "createDonation",
              resourceRef: donationId,
              outcome: "SUCCESS",
            }),
          ),
        ],
      }),
    );

  const countDonations = async () =>
    (await doc.send(new ScanCommand({ TableName: config.tables.donations }))).Count ?? 0;

  it("la primera reserva escribe clave, donación y auditoría; la repetición se cancela sin efectos", async () => {
    const donationId = "00000000-0000-4000-8000-0000000000e1";
    await createDonationTransaction(
      donationId,
      buildIdempotencyRecord({
        donorSub: DONOR_A_SUB,
        idempotencyKey: IDEMPOTENCY_KEY_1,
        payload,
        donationId,
      }),
    );
    expect(await countDonations()).toBe(1);

    const error = await createDonationTransaction(
      "00000000-0000-4000-8000-0000000000e2",
      buildIdempotencyRecord({
        donorSub: DONOR_A_SUB,
        idempotencyKey: IDEMPOTENCY_KEY_1,
        payload,
        donationId: "00000000-0000-4000-8000-0000000000e2",
      }),
    ).catch((caught: unknown) => caught);

    expect(cancellationCodes(error)).toHaveLength(3);
    expect(failedConditionAt(error, 0)).toBe(true);
    expect(await countDonations()).toBe(1); // sin escrituras parciales
  });

  it("tras la cancelación, el registro almacenado permite decidir replay o conflicto", async () => {
    const stored = (
      await doc.send(
        new GetCommand({
          TableName: config.tables.idempotency,
          Key: { pk: buildIdempotencyPk(DONOR_A_SUB, IDEMPOTENCY_KEY_1) },
          ConsistentRead: true,
        }),
      )
    ).Item as IdempotencyRecord;

    expect(decideIdempotency(stored, payload)).toMatchObject({
      kind: "replay",
      responseStatus: 201,
    });
    expect(decideIdempotency(stored, { ...payload, amountCents: 501 })).toEqual({
      kind: "conflict",
    });
    expect(decideIdempotency(stored, { ...payload, extra: true })).toEqual({ kind: "conflict" });
  });

  it("10 solicitudes concurrentes con la misma clave crean exactamente una donación", async () => {
    const key = "9b2f6c1e-5d0a-4c58-9d3e-0f1d2c3b4a59";
    const before = await countDonations();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => {
        const donationId = `00000000-0000-4000-8000-00000000f${String(index).padStart(3, "0")}`;
        return createDonationTransaction(
          donationId,
          buildIdempotencyRecord({
            donorSub: DONOR_A_SUB,
            idempotencyKey: key,
            payload,
            donationId,
          }),
        );
      }),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(9);
    expect(await countDonations()).toBe(before + 1);
  });

  it("el evento de auditoría queda consultable por tipo y sin el sub en claro", async () => {
    const result = await doc.send(
      new QueryCommand({
        TableName: config.tables.audit,
        KeyConditionExpression: "eventType = :t",
        ExpressionAttributeValues: { ":t": "DONATION_CREATED" },
      }),
    );
    expect((result.Count ?? 0) >= 1).toBe(true);
    expect(JSON.stringify(result.Items)).not.toContain(DONOR_A_SUB);
  });
});

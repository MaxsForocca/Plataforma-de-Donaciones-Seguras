# Procedimiento de Desmantelamiento y Limpieza de Recursos (Cleanup Guide)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Objetivo:** Garantizar la destrucción completa de recursos en AWS para evitar costos residuales y respetar el límite del AWS Free Tier (T112).  
**Herramientas:** AWS CLI v2, AWS SAM CLI.

---

## 1. Orden de Desmantelamiento de Recursos

Debido a las políticas de retención de AWS, ciertos recursos (como buckets S3 que contienen objetos) bloquean la eliminación automática de CloudFormation si no se purgan previamente. Se debe seguir este orden exacto:

### Paso 1: Vaciar el Bucket S3 de la SPA
Si el bucket de hosting de frontend contiene los artefactos de la build:
```bash
# Reemplazar con el nombre real del bucket creado por el stack
export BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name donaciones-academic \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

aws s3 rm s3://${BUCKET_NAME} --recursive
```

### Paso 2: Ejecutar `sam delete`
Eliminar la pila principal desplegada por AWS SAM:
```bash
sam delete --stack-name donaciones-academic --no-prompts --region us-east-1
```
*SAM eliminará automáticamente: API Gateway HTTP API, las 9 funciones Lambda, las 4 tablas DynamoDB, la distribución CloudFront, el rol OAC, las políticas IAM y el bucket S3 ahora vacío.*

### Paso 3: Verificar y Eliminar el User Pool de Cognito
Si el User Pool fue creado de forma externa o tiene política `DeletionPolicy: Retain`:
```bash
# Listar User Pools para confirmar estado
aws cognito-idp list-user-pools --max-results 10 --region us-east-1

# Si persiste, eliminarlo manualmente por su Id:
aws cognito-idp delete-user-pool --user-pool-id <USER_POOL_ID> --region us-east-1
```

### Paso 4: Eliminar Grupos de Logs en CloudWatch Logs
Aunque la plantilla configura una retención automática de 14 días (`RetentionInDays: 14`), para una limpieza inmediata:
```bash
for log_group in $(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/donaciones-" \
  --query "logGroups[*].logGroupName" \
  --output text --region us-east-1); do
  echo "Eliminando log group: ${log_group}"
  aws logs delete-log-group --log-group-name "${log_group}" --region us-east-1
done
```

---

## 2. Lista de Verificación de Ausencia de Recursos Residuales

Ejecutar las siguientes consultas para certificar que la cuenta AWS no mantiene recursos activos:

| Servicio AWS | Comando de Verificación | Resultado Esperado |
|---|---|---|
| **CloudFormation** | `aws cloudformation describe-stacks --stack-name donaciones-academic` | `Stack with id ... does not exist` |
| **DynamoDB** | `aws dynamodb list-tables` | Ninguna tabla `Projects`, `Donations`, `Idempotency`, `Audit` |
| **Lambda** | `aws lambda list-functions --query "Functions[?contains(FunctionName, 'donaciones')].FunctionName"` | `[]` (arreglo vacío) |
| **API Gateway** | `aws apigatewayv2 get-apis --query "Items[?contains(Name, 'donaciones')].ApiId"` | `[]` (arreglo vacío) |
| **CloudFront** | `aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment, 'donaciones')].Id"` | `null` o vacío |
| **S3** | `aws s3 ls \| grep donaciones` | Salida vacía |
| **Cognito** | `aws cognito-idp list-user-pools --max-results 10` | Sin pools vinculados al proyecto |

---

## 3. Conclusión

El procedimiento documentado asegura que ningún recurso permanezca consumiendo cuota o generando cargos tras la conclusión de las pruebas del laboratorio.

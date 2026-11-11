// Punto de entrada de @donaciones/shared.
// `canonical` usa node:crypto y no se reexporta aquí para no arrastrarlo al bundle de la SPA:
// el backend lo importa explícitamente desde "@donaciones/shared/canonical".
export * from "./schemas";

/** Host-provided schemas are durable enrollment data, never a credential channel. */
export function assertPublicMetadata(value: unknown, credentials: readonly string[]): void {
  const encoded=JSON.stringify(value);
  if(credentials.some(secret=>secret && encoded.includes(JSON.stringify(secret).slice(1,-1))))
    throw new Error("Host tool metadata contains credential material. Repair the adapter before enrolling it.");
}

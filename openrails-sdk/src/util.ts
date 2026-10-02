export function encPath(value: string): string {
  if (!value || value.length > 1024 || value.split('/').some(part => part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Names must be non-empty, without control characters or . / .. segments');
  }
  return value.split('/').map(encodeURIComponent).join('/');
}
export function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

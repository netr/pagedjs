// Debug utility to help with troubleshooting

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debugLog(message: string, data?: any): void {
  // eslint-disable-next-line no-console
  console.log(`🔍 DEBUG - ${message}`, data ? data : '');
}

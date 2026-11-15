// The hash git gives a file with this content. Comparing it with the hash GitHub reports
// tells whether a file differs without downloading it.

export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode('blob ' + body.length + '\0');
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

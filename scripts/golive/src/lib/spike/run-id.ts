/** `20261028t041944`: the spike's run id (sender_batch_ids derive from it). Pure, so the browser bundle can use it. */
export const runIdFor = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', 't').toLowerCase();

/** Equal-power curves keep unrelated recordings from dipping at the midpoint. */
export function crossfadeCurves(startAngle = 0) {
  const incoming = new Float32Array(129);
  const outgoing = new Float32Array(129);
  for (let i = 0; i < incoming.length; i++) {
    const angle = startAngle + (Math.PI / 2 - startAngle) * i / (incoming.length - 1);
    incoming[i] = Math.sin(angle); outgoing[i] = Math.cos(angle);
  }
  incoming[incoming.length - 1] = 1; outgoing[outgoing.length - 1] = 0;
  return { incoming, outgoing };
}

export function crossfadeDuration(requested: number, outgoingLength: number, incomingLength: number, remaining: number) {
  return Math.max(0, Math.min(requested, outgoingLength / 2, incomingLength / 2, remaining));
}

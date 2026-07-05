// Minimal ambient declaration for the `eventsource` package (it ships no types).
// Covers only the surface the keeper uses in txline.ts. Swap for `@types/eventsource`
// if you'd rather pull the full typings.
declare module "eventsource" {
  export default class EventSource {
    constructor(url: string, init?: any);
    onopen: ((ev: any) => void) | null;
    onmessage: ((ev: any) => void) | null;
    onerror: ((ev: any) => void) | null;
    close(): void;
    readonly url: string;
  }
}

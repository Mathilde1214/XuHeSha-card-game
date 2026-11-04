import WebSocket from 'ws';
export class Client {
  ws: WebSocket; msgs: any[] = []; waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];
  onMsg?: (m: any) => void;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)); this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
      this.onMsg?.(m);
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  next(pred: (m: any) => boolean, ms = 5000) {
    const hit = this.msgs.find(pred); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise<any>((res, rej) => { const t = setTimeout(() => rej(new Error('等待消息超时')), ms); this.waiters.push({ pred, res: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); } }); });
  }
  close() { this.ws.close(); }
}

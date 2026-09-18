/** Проверка SOCKS5/HTTP-прокси через TCP (cloudflare:sockets или node:net). */

export type ProxyCheckInput = {
  host: string;
  port: number;
  protocol: "socks5" | "http";
  username?: string;
  password?: string;
};

export type ProxyCheckResult = {
  ok: boolean;
  latencyMs: number;
  exitIp?: string;
  error?: string;
};

const CHECK_HOST = "api.ipify.org";
const CHECK_PORT = 80;
const TIMEOUT_MS = 8_000;

type TcpSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close: () => Promise<void>;
};

async function openTcpNode(host: string, port: number): Promise<TcpSocket> {
  const net = await import("node:net");
  return await new Promise<TcpSocket>((resolve, reject) => {
    const sock = net.connect({ host, port });
    sock.setNoDelay(true);
    const onErr = (err: Error) => reject(err);
    sock.once("error", onErr);
    sock.once("connect", () => {
      sock.off("error", onErr);
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          sock.on("data", (chunk: Buffer) =>
            controller.enqueue(new Uint8Array(chunk)),
          );
          sock.on("end", () => {
            try {
              controller.close();
            } catch {
              /* ignore */
            }
          });
          sock.on("error", (err) => controller.error(err));
        },
        cancel() {
          sock.destroy();
        },
      });
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise((res, rej) => {
            sock.write(Buffer.from(chunk), (err) => (err ? rej(err) : res()));
          });
        },
        close() {
          return new Promise((res) => sock.end(() => res()));
        },
        abort() {
          sock.destroy();
        },
      });
      resolve({
        readable,
        writable,
        close: async () => {
          sock.destroy();
        },
      });
    });
  });
}

async function openTcp(host: string, port: number): Promise<TcpSocket> {
  // Локальный Node/vinext: cloudflare:sockets часто фейлит TCP к прокси
  // («cannot connect to the specified address»), хотя порт открыт.
  const isNode =
    typeof process !== "undefined" &&
    !!(process as { versions?: { node?: string } }).versions?.node;
  if (isNode) {
    return openTcpNode(host, port);
  }
  const { connect } = await import("cloudflare:sockets");
  return connect({ hostname: host, port }, { secureTransport: "off" }) as TcpSocket;
}

class ByteReader {
  private buffer = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  private async fill(n: number) {
    while (this.buffer.length < n && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.done = true;
        break;
      }
      if (value?.length) {
        const next = new Uint8Array(this.buffer.length + value.length);
        next.set(this.buffer);
        next.set(value, this.buffer.length);
        this.buffer = next;
      }
    }
  }

  async readExact(n: number): Promise<Uint8Array> {
    await this.fill(n);
    if (this.buffer.length < n) throw new Error("Соединение закрыто прокси");
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }

  async readUntil(pred: (buf: Uint8Array) => boolean, max = 8192): Promise<Uint8Array> {
    while (!pred(this.buffer) && this.buffer.length < max && !this.done) {
      await this.fill(this.buffer.length + 1);
    }
    if (!pred(this.buffer)) throw new Error("Таймаут ответа прокси");
    return this.buffer;
  }

  async release() {
    try {
      this.reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

async function writeAll(writable: WritableStream<Uint8Array>, data: Uint8Array) {
  const w = writable.getWriter();
  try {
    await w.write(data);
  } finally {
    w.releaseLock();
  }
}

function encodeStr(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function socks5Handshake(
  socket: TcpSocket,
  reader: ByteReader,
  input: ProxyCheckInput,
) {
  const user = input.username || "";
  const pass = input.password || "";
  const needAuth = Boolean(user || pass);

  // Предлагаем и no-auth, и user/pass — провайдер выберет
  await writeAll(
    socket.writable,
    needAuth
      ? new Uint8Array([0x05, 0x02, 0x00, 0x02])
      : new Uint8Array([0x05, 0x01, 0x00]),
  );

  const method = await reader.readExact(2);
  if (method[0] !== 0x05) throw new Error("Прокси не говорит SOCKS5");
  if (method[1] === 0xff) throw new Error("SOCKS5: метод авторизации отклонён");

  if (method[1] === 0x02) {
    const u = encodeStr(user);
    const p = encodeStr(pass);
    if (u.length > 255 || p.length > 255) throw new Error("Слишком длинный логин/пароль");
    const auth = new Uint8Array(3 + u.length + p.length);
    auth[0] = 0x01;
    auth[1] = u.length;
    auth.set(u, 2);
    auth[2 + u.length] = p.length;
    auth.set(p, 3 + u.length);
    await writeAll(socket.writable, auth);
    const authResp = await reader.readExact(2);
    if (authResp[1] !== 0x00) throw new Error("SOCKS5: неверный логин или пароль");
  } else if (method[1] !== 0x00) {
    throw new Error(`SOCKS5: неподдерживаемый метод ${method[1]}`);
  }

  const hostBytes = encodeStr(CHECK_HOST);
  const req = new Uint8Array(7 + hostBytes.length);
  req[0] = 0x05;
  req[1] = 0x01; // CONNECT
  req[2] = 0x00;
  req[3] = 0x03; // domain
  req[4] = hostBytes.length;
  req.set(hostBytes, 5);
  const portOff = 5 + hostBytes.length;
  req[portOff] = (CHECK_PORT >> 8) & 0xff;
  req[portOff + 1] = CHECK_PORT & 0xff;
  await writeAll(socket.writable, req);

  const head = await reader.readExact(4);
  if (head[0] !== 0x05) throw new Error("SOCKS5: битый ответ CONNECT");
  if (head[1] !== 0x00) {
    const map: Record<number, string> = {
      1: "общая ошибка",
      2: "запрещено правилами",
      3: "сеть недоступна",
      4: "хост недоступен",
      5: "соединение отклонено",
      6: "TTL истёк",
      7: "команда не поддерживается",
      8: "тип адреса не поддерживается",
    };
    throw new Error(`SOCKS5 CONNECT: ${map[head[1]!] || `код ${head[1]}`}`);
  }
  const atyp = head[3]!;
  if (atyp === 0x01) await reader.readExact(4 + 2);
  else if (atyp === 0x03) {
    const len = (await reader.readExact(1))[0]!;
    await reader.readExact(len + 2);
  } else if (atyp === 0x04) await reader.readExact(16 + 2);
  else throw new Error("SOCKS5: неизвестный тип адреса");
}

function basicAuthHeader(user: string, pass: string): string {
  const bytes = encodeStr(`${user}:${pass}`);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return `Proxy-Authorization: Basic ${btoa(bin)}\r\n`;
}

async function httpProxyConnect(
  socket: TcpSocket,
  reader: ByteReader,
  input: ProxyCheckInput,
) {
  const auth =
    input.username || input.password
      ? basicAuthHeader(input.username || "", input.password || "")
      : "";
  // Абсолютный URL через HTTP-прокси (без CONNECT — проще для проверки)
  const req =
    `GET http://${CHECK_HOST}/ HTTP/1.1\r\n` +
    `Host: ${CHECK_HOST}\r\n` +
    `Connection: close\r\n` +
    `User-Agent: Uniseller-ProxyCheck/1\r\n` +
    auth +
    `\r\n`;
  await writeAll(socket.writable, encodeStr(req));
  const buf = await reader.readUntil(
    (b) => new TextDecoder().decode(b).includes("\r\n\r\n"),
    16_384,
  );
  const text = new TextDecoder().decode(buf);
  const status = text.match(/^HTTP\/\d\.\d\s+(\d+)/);
  if (!status) throw new Error("HTTP-прокси: нет ответа");
  const code = Number(status[1]);
  if (code === 407) throw new Error("HTTP-прокси: нужна авторизация");
  if (code < 200 || code >= 300) throw new Error(`HTTP-прокси: статус ${code}`);
  const body = text.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
  const ip = body.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
  if (!ip) throw new Error("HTTP-прокси: нет IP в ответе");
  return ip;
}

async function httpGetIpify(socket: TcpSocket, reader: ByteReader) {
  const req =
    `GET / HTTP/1.1\r\nHost: ${CHECK_HOST}\r\nConnection: close\r\nUser-Agent: Uniseller-ProxyCheck/1\r\n\r\n`;
  await writeAll(socket.writable, encodeStr(req));
  const buf = await reader.readUntil(
    (b) => {
      const t = new TextDecoder().decode(b);
      return t.includes("\r\n\r\n") && (t.length > 80 || t.includes("\r\n\r\n") && /(?:\d{1,3}\.){3}\d{1,3}/.test(t));
    },
    16_384,
  );
  const text = new TextDecoder().decode(buf);
  const status = text.match(/^HTTP\/\d\.\d\s+(\d+)/);
  if (!status || Number(status[1]) >= 400) {
    throw new Error(`Проверка через прокси не удалась (${status?.[1] || "?"})`);
  }
  const body = text.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
  const ip = body.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
  if (!ip) throw new Error("Прокси ответил, но IP не получен");
  return ip;
}

export async function checkProxy(input: ProxyCheckInput): Promise<ProxyCheckResult> {
  const started = Date.now();
  let socket: TcpSocket | null = null;
  let reader: ByteReader | null = null;
  try {
    const race = Promise.race([
      (async () => {
        socket = await openTcp(input.host, input.port);
        reader = new ByteReader(socket.readable);
        if (input.protocol === "http") {
          const exitIp = await httpProxyConnect(socket, reader, input);
          return exitIp;
        }
        await socks5Handshake(socket, reader, input);
        return await httpGetIpify(socket, reader);
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("Таймаут подключения к прокси")), TIMEOUT_MS),
      ),
    ]);
    const exitIp = await race;
    return { ok: true, latencyMs: Date.now() - started, exitIp };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: (e as Error).message || "Ошибка проверки",
    };
  } finally {
    try {
      await reader?.release();
    } catch {
      /* ignore */
    }
    try {
      await socket?.close();
    } catch {
      /* ignore */
    }
  }
}

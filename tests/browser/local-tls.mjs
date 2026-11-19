// Ephemeral self-signed certificate, used only by isolated loopback browser tests.
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
const der = (tag, ...parts) => {
  const b = Buffer.concat(parts)
  const n = b.length
  const len =
    n < 128
      ? Buffer.from([n])
      : Buffer.from([0x80 + (n > 255 ? 2 : 1), ...(n > 255 ? [n >> 8, n & 255] : [n])])
  return Buffer.concat([Buffer.from([tag]), len, b])
}
const seq = (...p) => der(0x30, ...p),
  oid = (h) => der(6, Buffer.from(h, 'hex')),
  integer = (b) => der(2, Buffer.from(b)),
  octet = (b) => der(4, b)
export function localTls() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const alg = seq(oid('2a864886f70d01010b'), der(5, Buffer.alloc(0)))
  const name = seq(der(0x31, seq(oid('550403'), der(12, Buffer.from('HireFlow fictional TLS')))))
  const utc = (d) => der(23, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const ext = der(0xa3, seq(seq(oid('551d11'), octet(seq(der(0x87, Buffer.from([127, 0, 0, 1])))))))
  const tbs = seq(
    der(0xa0, integer([2])),
    integer([1]),
    alg,
    name,
    seq(utc(new Date(Date.now() - 86400000)), utc(new Date(Date.now() + 86400000 * 7))),
    name,
    spki,
    ext
  )
  const cert = seq(tbs, alg, der(3, Buffer.from([0]), sign('sha256', tbs, privateKey)))
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert:
      '-----BEGIN CERTIFICATE-----\n' +
      cert
        .toString('base64')
        .match(/.{1,64}/g)
        .join('\n') +
      '\n-----END CERTIFICATE-----\n',
    spki: createHash('sha256').update(spki).digest('base64')
  }
}

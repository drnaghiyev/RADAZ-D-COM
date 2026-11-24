// A stored ZIP member is already a contiguous DICOM file. Read its directory
// and local header, and keep the pixels backed by a slice of the original file.
export async function storedZipMembers(file: File): Promise<File[] | null> {
  const tailOffset = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(tailOffset).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && !(tail.getUint32(end, true) === 0x06054b50 &&
    end + 22 + tail.getUint16(end + 20, true) === tail.byteLength)) end--;
  if (end < 0 || tail.getUint32(end + 4, true) !== 0) return null;
  const count = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryStart = tail.getUint32(end + 16, true);
  if (!count || count > 8192 || count !== tail.getUint16(end + 8, true) ||
    directorySize > 16 * 1024 ** 2 || directoryStart + directorySize !== tailOffset + end) return null;
  const directory = new DataView(await file.slice(directoryStart, directoryStart + directorySize).arrayBuffer());
  const members: {name:string; offset:number; size:number; flags:number}[] = [];
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directorySize || directory.getUint32(at, true) !== 0x02014b50) return null;
    const flags = directory.getUint16(at + 8, true);
    const size = directory.getUint32(at + 20, true);
    const length = directory.getUint16(at + 28, true);
    const next = at + 46 + length + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
    if ((flags & ~0x808) || directory.getUint16(at + 10, true) !== 0 || size !== directory.getUint32(at + 24, true) ||
      directory.getUint16(at + 34, true) !== 0 || next > directorySize || !length) return null;
    const nameBytes = new Uint8Array(directory.buffer, at + 46, length);
    if (!(flags & 0x800) && nameBytes.some(byte => byte > 127)) return null;
    let name: string;
    try { name = decoder.decode(nameBytes); } catch { return null; }
    if (name.includes('\0') || name.split('/').includes('..')) return null;
    if (!name.endsWith('/')) members.push({name, offset:directory.getUint32(at + 42, true), size, flags});
    at = next;
  }
  if (at !== directorySize) return null;
  const result: File[] = [];
  for (let start = 0; start < members.length; start += 24) {
    const files = await Promise.all(members.slice(start, start + 24).map(async member => {
      const local = new DataView(await file.slice(member.offset, member.offset + 30).arrayBuffer());
      if (local.byteLength !== 30 || local.getUint32(0, true) !== 0x04034b50 ||
        local.getUint16(6,true) !== member.flags || local.getUint16(8,true) !== 0) return null;
      const data = member.offset + 30 + local.getUint16(26,true) + local.getUint16(28,true);
      if (data + member.size > directoryStart) return null;
      return new File([file.slice(data,data + member.size)], member.name, {type:'application/dicom'});
    }));
    for (const member of files) {
      if (!member) return null;
      result.push(member);
    }
  }
  return result;
}

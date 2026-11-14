// HWP 5.0 문서에서 문단 텍스트를 순서대로 꺼낸다(Node 내장 zlib만 사용).
// HWP 5.0은 OLE 복합 문서(MS-CFB)이고, 본문은 BodyText/SectionN 스트림의 레코드열이다.
// 문단 텍스트는 HWPTAG_PARA_TEXT(태그 67) 레코드에 UTF-16LE로 들어 있다. 표의 칸도 문단이라
// 문서 순서대로 함께 나온다. 배포용 문서(복사 방지)는 읽지 않는다 — 실패로 알린다.
import { inflateRawSync } from 'node:zlib';

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const NO_STREAM = 0xffffffff;

/** MS-CFB 복합 문서 → { 경로: Buffer } (스트림만). 경로는 'BodyText/Section0' 형태. */
export function readCompoundFile(buf) {
  if (!buf.subarray(0, 8).equals(CFB_SIGNATURE)) throw new Error('OLE 복합 문서가 아닙니다.');
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSectorSize = 1 << buf.readUInt16LE(0x20);
  const firstDirSector = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c);
  let difatSector = buf.readUInt32LE(0x44);
  const sector = (sid) => buf.subarray((sid + 1) * sectorSize, (sid + 2) * sectorSize);

  // DIFAT → FAT 섹터 목록
  const fatSectors = [];
  for (let i = 0; i < 109; i += 1) {
    const sid = buf.readUInt32LE(0x4c + i * 4);
    if (sid !== FREE_SECT) fatSectors.push(sid);
  }
  while (difatSector !== END_OF_CHAIN && difatSector !== FREE_SECT) {
    const s = sector(difatSector);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) {
      const sid = s.readUInt32LE(i * 4);
      if (sid !== FREE_SECT) fatSectors.push(sid);
    }
    difatSector = s.readUInt32LE(sectorSize - 4);
  }
  const fat = [];
  for (const sid of fatSectors) {
    const s = sector(sid);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(s.readUInt32LE(i * 4));
  }
  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let sid = start; sid !== END_OF_CHAIN && sid !== FREE_SECT; sid = table[sid]) {
      if (seen.has(sid) || sid >= table.length) throw new Error('손상된 섹터 체인입니다.');
      seen.add(sid);
      out.push(sid);
    }
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start, fat).map(sector));

  // 디렉터리 엔트리(128바이트)
  const dirBuf = readChain(firstDirSector);
  const entries = [];
  for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
    const nameLen = dirBuf.readUInt16LE(off + 64);
    entries.push({
      name: dirBuf.subarray(off, off + Math.max(0, nameLen - 2)).toString('utf16le'),
      type: dirBuf[off + 66],
      left: dirBuf.readUInt32LE(off + 68),
      right: dirBuf.readUInt32LE(off + 72),
      child: dirBuf.readUInt32LE(off + 76),
      start: dirBuf.readUInt32LE(off + 116),
      size: dirBuf.readUInt32LE(off + 120),
    });
  }
  const root = entries[0];
  const miniStream = root.start === END_OF_CHAIN ? Buffer.alloc(0) : readChain(root.start);
  const miniFat = [];
  if (firstMiniFat !== END_OF_CHAIN) {
    const mf = readChain(firstMiniFat);
    for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  }
  const readStream = (e) => {
    if (e.size < miniCutoff) {
      const parts = chain(e.start, miniFat).map((sid) => miniStream.subarray(sid * miniSectorSize, (sid + 1) * miniSectorSize));
      return Buffer.concat(parts).subarray(0, e.size);
    }
    return readChain(e.start).subarray(0, e.size);
  };

  // 레드-블랙 트리 형제(left/right)와 자식(child)을 따라 경로를 만든다. 깊이 제한 대신 방문 기록으로
  // 순환을 막고, 범위 밖 번호나 순환이 보이면 조용히 건너뛰지 않고 실패한다.
  const streams = {};
  const seen = new Set();
  const stack = [[root.child, '']];
  while (stack.length) {
    const [sid, prefix] = stack.pop();
    if (sid === NO_STREAM) continue;
    if (sid >= entries.length) throw new Error(`손상된 디렉터리: 엔트리 번호 ${sid}가 범위 밖입니다.`);
    if (seen.has(sid)) throw new Error(`손상된 디렉터리: 엔트리 ${sid}가 두 번 연결되어 있습니다.`);
    seen.add(sid);
    const e = entries[sid];
    stack.push([e.left, prefix], [e.right, prefix]);
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 2) streams[path] = readStream(e);
    else if (e.type === 1) stack.push([e.child, path]);
  }
  return streams;
}

// 제어 문자: 1·2·3·11·12·14~18·21~23(확장)과 4~9·19·20(인라인)은 8 WCHAR 차지.
const WIDE_CONTROLS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

/** HWPTAG_PARA_TEXT 페이로드 → 문자열. 탭은 '\t', 강제 줄바꿈(10)은 '\n'으로 남기고 문단끝(13)은 버린다. */
export function paraText(payload) {
  const units = [];
  for (let i = 0; i + 1 < payload.length;) {
    const c = payload.readUInt16LE(i);
    if (c < 32) {
      if (WIDE_CONTROLS.has(c)) {
        if (c === 9) units.push(9);
        i += 16;
        continue;
      }
      if (c === 10) units.push(10); // 강제 줄바꿈
      else if (c === 24) units.push(0x2d); // 하이픈
      else if (c === 30 || c === 31) units.push(0x20); // 묶음·고정폭 빈칸
      i += 2;
      continue;
    }
    units.push(c);
    i += 2;
  }
  const out = Buffer.alloc(units.length * 2);
  units.forEach((u, k) => out.writeUInt16LE(u, k * 2));
  return out.toString('utf16le');
}

const HWPTAG_PARA_HEADER = 66;
const HWPTAG_PARA_TEXT = 67;
const HWPTAG_CTRL_HEADER = 71;
const HWPTAG_LIST_HEADER = 72;
const HWPTAG_TABLE = 77;

/**
 * FileHeader를 읽어 HWP 5.0 문서인지, 암호·배포용(복사 방지)이 아닌지 확인한다. 받은 파일 검사에도 쓴다.
 * @returns {{ version: string, compressed: boolean }}
 */
export function checkHwp(buf, streams = readCompoundFile(buf)) {
  const header = streams.FileHeader;
  if (!header || !header.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) {
    throw new Error('HWP 5.0 문서가 아닙니다.');
  }
  const v = header.readUInt32LE(32);
  const flags = header.readUInt32LE(36);
  if (flags & 0x2) throw new Error('암호가 걸린 HWP 문서는 읽지 않습니다.');
  if (flags & 0x4) throw new Error('배포용(복사 방지) HWP 문서는 읽지 않습니다.');
  if (!Object.keys(streams).some((p) => /^BodyText\/Section\d+$/.test(p))) throw new Error('HWP 본문(BodyText) 스트림이 없습니다.');
  return { version: [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff].join('.'), compressed: (flags & 0x1) !== 0 };
}

/** 본문 레코드열: { tag, level, data } — 구역(Section) 순서대로 이어 붙인다. */
function hwpRecords(buf) {
  const streams = readCompoundFile(buf);
  const { compressed } = checkHwp(buf, streams);
  const sections = Object.keys(streams)
    .filter((p) => /^BodyText\/Section\d+$/.test(p))
    .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  const records = [];
  for (const path of sections) {
    const data = compressed ? inflateRawSync(streams[path]) : streams[path];
    let pos = 0;
    while (pos + 4 <= data.length) {
      const h = data.readUInt32LE(pos);
      pos += 4;
      let size = h >>> 20;
      if (size === 0xfff) { size = data.readUInt32LE(pos); pos += 4; }
      if (pos + size > data.length) throw new Error(`${path}: 레코드가 스트림 끝을 넘습니다.`);
      records.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: data.subarray(pos, pos + size) });
      pos += size;
    }
  }
  return records;
}

/** HWP 5.0 파일 버퍼 → 문단 문자열 배열(문서 순서, 표 칸 포함, 빈 문단 제외 안 함). */
export function hwpParagraphs(buf) {
  return hwpRecords(buf).filter((r) => r.tag === HWPTAG_PARA_TEXT).map((r) => paraText(r.data));
}

// 컨트롤 id는 4글자를 거꾸로 저장한다(' lbt' → 'tbl ').
const ctrlId = (data) => data.subarray(0, 4).toString('latin1').split('').reverse().join('');

/**
 * HWP 5.0 → 본문 최상위 문단 배열. 문단은 { text, ctrls }이고, 표 컨트롤은
 * { id: 'tbl ', rows, cols, cells: [{ row, col, rowSpan, colSpan, paras }] }로 칸 위치까지 남긴다
 * (칸 안 문단도 같은 모양 — 표 안 표도 그대로 따라간다). 그 밖의 컨트롤(글상자·머리말 등)은
 * { id, texts }로 안의 글자만 모은다. 레코드 수준(level)으로 소속을 가린다.
 */
export function hwpBlocks(buf) {
  const recs = hwpRecords(buf);
  let i = 0;
  const parseParas = (level, max = Infinity) => {
    const out = [];
    while (i < recs.length && out.length < max) {
      const r = recs[i];
      if (r.level < level) break;
      if (r.tag !== HWPTAG_PARA_HEADER || r.level !== level) { i += 1; continue; }
      i += 1;
      const para = { text: '', ctrls: [] };
      while (i < recs.length && recs[i].level > level) {
        const c = recs[i];
        if (c.tag === HWPTAG_PARA_TEXT && c.level === level + 1) { para.text = paraText(c.data); i += 1; }
        else if (c.tag === HWPTAG_CTRL_HEADER && c.level === level + 1) para.ctrls.push(parseCtrl(level + 1));
        else i += 1;
      }
      out.push(para);
    }
    return out;
  };
  const parseCtrl = (level) => {
    const id = ctrlId(recs[i].data);
    i += 1;
    if (id === 'tbl ') {
      const table = { id, rows: 0, cols: 0, cells: [] };
      while (i < recs.length && recs[i].level > level) {
        const c = recs[i];
        if (c.tag === HWPTAG_TABLE && c.level === level + 1) {
          table.rows = c.data.readUInt16LE(4);
          table.cols = c.data.readUInt16LE(6);
          i += 1;
        } else if (c.tag === HWPTAG_LIST_HEADER && c.level === level + 1) {
          // LIST_HEADER: 문단 수(2) + 예약(2) + 속성(4) 다음에 칸 주소(열·행)와 병합 범위(열·행).
          const n = c.data.readUInt16LE(0);
          const cell = {
            col: c.data.readUInt16LE(8), row: c.data.readUInt16LE(10),
            colSpan: c.data.readUInt16LE(12), rowSpan: c.data.readUInt16LE(14),
          };
          i += 1;
          cell.paras = parseParas(level + 1, n);
          table.cells.push(cell);
        } else i += 1;
      }
      for (const cell of table.cells) {
        if (cell.row + cell.rowSpan > table.rows || cell.col + cell.colSpan > table.cols) {
          throw new Error(`표 칸 주소가 표 크기(${table.rows}x${table.cols})를 넘습니다: r${cell.row}c${cell.col}`);
        }
      }
      return table;
    }
    const other = { id, texts: [] };
    while (i < recs.length && recs[i].level > level) {
      if (recs[i].tag === HWPTAG_PARA_TEXT) other.texts.push(paraText(recs[i].data));
      i += 1;
    }
    return other;
  };
  return parseParas(0);
}

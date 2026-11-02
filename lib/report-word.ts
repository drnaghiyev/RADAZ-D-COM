import {reportLabels} from './report-language';
import type { SavedReport } from './report-store';
import { plainReportHtml, safeReportLogo, sanitizeReportHtml } from './report-rich';

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

type RunFormat = { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: string; color?: string };

function run(value: string, format: RunFormat = {}): string {
  if (!value) return '';
  const properties = [format.bold && '<w:b/>', format.italic && '<w:i/>', format.underline && '<w:u w:val="single"/>',
    format.size && `<w:sz w:val="${Math.round(format.size * 2)}"/>`,
    format.font && `<w:rFonts w:ascii="${xml(format.font)}" w:hAnsi="${xml(format.font)}"/>`,
    format.color && /^#[0-9a-f]{6}$/i.test(format.color) && `<w:color w:val="${format.color.slice(1)}"/>`].filter(Boolean).join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
}

function styled(node: Node, format: RunFormat): string {
  if (node.nodeType === 3) return run(node.textContent || '', format);
  if (node.nodeType !== 1) return '';
  const element = node as HTMLElement;
  if (element.tagName === 'BR') return '<w:r><w:br/></w:r>';
  const next = { ...format };
  if (['STRONG', 'B'].includes(element.tagName) || element.style.fontWeight === 'bold') next.bold = true;
  if (['EM', 'I'].includes(element.tagName) || element.style.fontStyle === 'italic') next.italic = true;
  if (element.tagName === 'U' || element.style.textDecorationLine.includes('underline')) next.underline = true;
  if (element.style.fontSize) {
    const n = Number.parseFloat(element.style.fontSize);
    if (Number.isFinite(n) && n >= 8 && n <= 36) next.size = n;
  }
  if (element.style.fontFamily) next.font = element.style.fontFamily;
  if (element.style.color) next.color = element.style.color;
  return [...element.childNodes].map(child => styled(child, next)).join('');
}

function paragraph(content: string, alignment = '', style = ''): string {
  const align = ['center', 'right', 'justify'].includes(alignment) ? `<w:jc w:val="${alignment === 'justify' ? 'both' : alignment}"/>` : '';
  return `<w:p>${align || style ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${align}</w:pPr>` : ''}${content || '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

function bodyParagraphs(html: string): string {
  const body = new DOMParser().parseFromString(sanitizeReportHtml(html), 'text/html').body;
  const blocks: string[] = [];
  for (const node of body.childNodes) {
    if (node.nodeType === 1 && ['UL', 'OL'].includes((node as Element).tagName)) {
      const list = node as HTMLElement;
      let n = 0;
      for (const child of list.children) if (child.tagName === 'LI') {
        n++;
        blocks.push(paragraph(run(list.tagName === 'OL' ? `${n}. ` : '• ') + styled(child, {}), (child as HTMLElement).style.textAlign));
      }
    } else if (node.nodeType === 1) {
      const element = node as HTMLElement;
      const heading = element.tagName === 'H2' || element.tagName === 'H3';
      blocks.push(paragraph(styled(element, heading ? { bold: true, size: element.tagName === 'H2' ? 18 : 14 } : {}), element.style.textAlign));
    } else if (node.textContent?.trim()) blocks.push(paragraph(styled(node, {})));
  }
  return blocks.join('');
}

function logoDrawing(data: string): { base64: string; xml: string } | null {
  const safe = safeReportLogo(data);
  if (!safe) return null;
  const base64 = safe.split(',')[1];
  const binary = atob(base64);
  if (binary.length < 24 || binary.slice(1, 4) !== 'PNG') return null;
  const dimension = (offset: number) => (((binary.charCodeAt(offset) << 24) >>> 0) +
    (binary.charCodeAt(offset + 1) << 16) + (binary.charCodeAt(offset + 2) << 8) + binary.charCodeAt(offset + 3)) >>> 0;
  const width = dimension(16), height = dimension(20);
  if (!width || !height || width > 20000 || height > 20000) return null;
  const scale = Math.min(1, 430 / width, 120 / height);
  const cx = Math.round(width * scale * 9525), cy = Math.round(height * scale * 9525);
  const drawing = `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Clinic logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return { base64, xml: paragraph(drawing, 'center') };
}

export async function buildReportDocx(report: SavedReport): Promise<Blob> {
  const labels=reportLabels(report.language);
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const logo = logoDrawing(report.logoData || '');
  const heading = report.header.split('\n').map((line, index) => paragraph(run(line, index === 0 ? { bold: true, size: 15 } : {}), 'center')).join('');
  const fields = [
    `${labels.patient}: ${report.patient || '—'}     ${labels.birth}: ${report.birth || '—'}`,
    `${labels.date}: ${report.date || '—'}     ${labels.study}: ${report.modality || '—'}`,
  ].map(line => paragraph(run(line))).join('');
  const formatted = report.bodyHtml?.trim() || plainReportHtml(report.body);
  const content = `${logo?.xml || ''}${heading}${paragraph(run(labels.title, { bold: true, size: 16 }), 'center')}${fields}${paragraph('')}${bodyParagraphs(formatted)}`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logo ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${logo ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : ''}</Relationships>`);
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:body></w:document>`);
  if (logo) zip.file('word/media/logo.png', logo.base64, { base64: true });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

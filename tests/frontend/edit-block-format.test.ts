import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { blocksToMarkdown, createBlock, parseIntoBlocks } from '../../static/ts/edit/blocks';

const SEPARATOR = '\n\n<!-- block -->\n\n';

function parseOne(markdown: string) {
  const blocks = parseIntoBlocks(markdown);
  expect(blocks).toHaveLength(1);
  return blocks[0]!;
}

function roundTrip(markdown: string): string {
  return blocksToMarkdown(parseIntoBlocks(markdown));
}

describe('the block format shared with the server', () => {
  const fixture = readFileSync('tests/fixtures/block-format.md', 'utf-8').trimEnd();

  it('parses tests/fixtures/block-format.md into its block types', () => {
    const blocks = parseIntoBlocks(fixture);
    expect(blocks.map((block) => block.type)).toEqual(['text', 'text', 'divider', 'row', 'html', 'text']);
    expect(blocks[5]).toMatchObject({ align: 'center', content: 'Centered text' });
    expect(blocks[4]).toMatchObject({ html: '<p>Sandboxed</p>', style: 'height: 240px' });
  });

  it('serializes that fixture back exactly', () => {
    expect(roundTrip(fixture)).toBe(fixture);
  });
});

describe('separators', () => {
  it('accepts the marker whitespace the server accepts', () => {
    const blocks = parseIntoBlocks('One\n  <!--block-->  \nTwo\n<!--   block   -->\n\nThree');
    expect(blocks.map((block) => (block as { content: string }).content)).toEqual(['One', 'Two', 'Three']);
  });

  it('does not split on a marker in the middle of a line', () => {
    expect(parseIntoBlocks('One <!-- block --> Two')).toHaveLength(1);
  });

  it('gives an empty document one empty text block', () => {
    expect(parseOne('   \n')).toMatchObject({ type: 'text', content: '' });
    expect(roundTrip('')).toBe('');
  });

  it('gives every block a distinct id', () => {
    const ids = parseIntoBlocks('A\n\n<!-- block -->\n\nB\n\n<!-- block -->\n\n<!-- row -->\nC\n<!-- col -->\nD\n<!-- /row -->')
      .flatMap((block) => (block.type === 'row' ? [block.id, block.left.id, block.right.id] : [block.id]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('text', () => {
  it('keeps markdown as it is', () => {
    expect(roundTrip('## Heading\n\nA **bold** line\n- item')).toBe('## Heading\n\nA **bold** line\n- item');
  });

  it.each(['center', 'right'])('keeps %s alignment in comment markers', (align) => {
    const markdown = `<!-- align:${align} -->\nCentered\n<!-- /align -->`;
    expect(parseOne(markdown)).toMatchObject({ type: 'text', align, content: 'Centered' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps unpaired alignment markers as text', () => {
    expect(parseOne('<!-- align:center -->\nOops')).toMatchObject({ type: 'text', align: 'left', content: '<!-- align:center -->\nOops' });
  });
});

describe('dividers', () => {
  it.each(['---', '***', '___', '-----'])('reads %s and writes ---', (markdown) => {
    expect(parseOne(markdown).type).toBe('divider');
    expect(roundTrip(markdown)).toBe('---');
  });
});

describe('code', () => {
  it('keeps the language and body', () => {
    const markdown = '```python\nprint("hi")\n\nx = 1\n```';
    expect(parseOne(markdown)).toMatchObject({ type: 'code', language: 'python', code: 'print("hi")\n\nx = 1' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('reads an unlabelled fence as plain text', () => {
    expect(parseOne('```\nx\n```')).toMatchObject({ language: 'text', code: 'x' });
  });
});

describe('images', () => {
  it('uses markdown syntax when unsized and left aligned', () => {
    const markdown = '![A cat](https://cdn.example/cat.webp)';
    expect(parseOne(markdown)).toMatchObject({ type: 'image', alt: 'A cat', src: 'https://cdn.example/cat.webp', style: null, align: 'left' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('uses an img tag once sized or aligned', () => {
    const sized = '<img src="a.webp" alt="" style="display: block; width: 300px">';
    expect(parseOne(sized)).toMatchObject({ type: 'image', style: 'display: block; width: 300px', align: 'left' });
    expect(roundTrip(sized)).toBe(sized);

    const centered = '<img src="a.webp" alt="" style="display: block; width: 300px; margin-left: auto; margin-right: auto">';
    expect(parseOne(centered)).toMatchObject({ align: 'center' });
    expect(roundTrip(centered)).toBe(centered);

    const right = '<img src="a.webp" alt="" style="display: block; margin-left: auto">';
    expect(parseOne(right)).toMatchObject({ align: 'right' });
    expect(roundTrip(right)).toBe(right);
  });

  it('keeps a caption, escaped', () => {
    const markdown = '![A](a.webp)\n<p class="media-caption">Tom &amp; Jerry &quot;live&quot; &#39;here&#39;</p>';
    expect(parseOne(markdown)).toMatchObject({ type: 'image', caption: 'Tom & Jerry "live" \'here\'' });
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe('videos', () => {
  it('writes controls for a plain video', () => {
    const markdown = '<video src="a.mp4" poster="p.webp" controls></video>';
    expect(parseOne(markdown)).toMatchObject({ type: 'video', src: 'a.mp4', poster: 'p.webp', autoplay: false });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('writes muted looping playback for autoplay', () => {
    const markdown = '<video src="a.mp4" autoplay loop muted playsinline></video>';
    expect(parseOne(markdown)).toMatchObject({ autoplay: true, poster: '' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps size, alignment, and caption', () => {
    const markdown = '<video src="a.mp4" controls style="display: block; width: 400px; margin-left: auto"></video>\n<p class="media-caption">Clip</p>';
    expect(parseOne(markdown)).toMatchObject({ align: 'right', caption: 'Clip' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('reads a nested source element', () => {
    expect(parseOne('<video controls><source src="a.mp4"></video>')).toMatchObject({ src: 'a.mp4' });
  });
});

describe('html', () => {
  it('keeps the body and a size style', () => {
    const markdown = '<!-- html style="width: 400px; height: 240px" -->\n<div>hi</div>\n<!-- /html -->';
    expect(parseOne(markdown)).toMatchObject({ type: 'html', html: '<div>hi</div>', style: 'width: 400px; height: 240px', align: 'left' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps alignment in the style', () => {
    const markdown = '<!-- html style="display: block; width: 400px; margin-left: auto; margin-right: auto" -->\n<b>x</b>\n<!-- /html -->';
    expect(parseOne(markdown)).toMatchObject({ align: 'center' });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('omits an empty style and keeps a caption', () => {
    const markdown = '<!-- html -->\n<b>x</b>\n<!-- /html -->\n<p class="media-caption">Cap</p>';
    expect(parseOne(markdown)).toMatchObject({ caption: 'Cap', style: null });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('stops growing a saved style with stray semicolons', () => {
    const once = roundTrip('<!-- html style="display: block; width: 524px;;; margin-left: auto; margin-right: auto" -->\n<b>x</b>\n<!-- /html -->');
    expect(once).toBe('<!-- html style="display: block; width: 524px; margin-left: auto; margin-right: auto" -->\n<b>x</b>\n<!-- /html -->');
    expect(roundTrip(once)).toBe(once);
  });
});

describe('image alt text', () => {
  it.each(['A "quoted" word', 'Tom & Jerry', 'x > y', "it's", 'literal &amp; text'])('round-trips %s through the sized form', (alt) => {
    const markdown = blocksToMarkdown([createBlock('image', { src: 'a.webp', alt, style: 'width: 300px' })]);
    expect(markdown).toContain('style="');
    expect(markdown.match(/<img [^>]*>/)).not.toBeNull();

    expect(parseOne(markdown)).toMatchObject({ type: 'image', src: 'a.webp', alt, style: expect.stringContaining('width: 300px') });
  });

  it('keeps a quote from ending the attribute', () => {
    const markdown = blocksToMarkdown([createBlock('image', { src: 'a.webp', alt: 'x" onerror="y', style: 'width: 300px' })]);
    expect(markdown).toContain('alt="x&quot; onerror=&quot;y"');
  });

  it('reads alt text already stored with entities', () => {
    expect(parseOne('<img src="a.webp" alt="a &amp; b" style="width: 1px">')).toMatchObject({ alt: 'a & b' });
  });
});

describe('callouts', () => {
  it('keeps content and text alignment', () => {
    const plain = '<div class="callout">Note</div>';
    expect(parseOne(plain)).toMatchObject({ type: 'callout', content: 'Note', align: 'left' });
    expect(roundTrip(plain)).toBe(plain);

    const aligned = '<div class="callout" style="text-align: right">Note</div>';
    expect(parseOne(aligned)).toMatchObject({ align: 'right' });
    expect(roundTrip(aligned)).toBe(aligned);
  });
});

describe('rows', () => {
  it('parses both columns as blocks', () => {
    const markdown = '<!-- row -->\n![L](l.webp)\n<!-- col -->\n## R\n<!-- /row -->';
    expect(parseOne(markdown)).toMatchObject({ type: 'row', left: { type: 'image', src: 'l.webp' }, right: { type: 'text', content: '## R' } });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('accepts the marker whitespace the server accepts', () => {
    expect(parseOne('<!--row-->\nA\n\n  <!--col-->  \nB\n<!--  /row  -->')).toMatchObject({ type: 'row', left: { content: 'A' }, right: { content: 'B' } });
  });

  it('treats a row without a column marker as text, as the server does', () => {
    expect(parseOne('<!-- row -->\nA\n<!-- /row -->').type).toBe('text');
  });

  it('keeps anything after a second column marker in the right column, as the server does', () => {
    expect(parseOne('<!-- row -->\nA\n<!-- col -->\nB\n<!-- col -->\nC\n<!-- /row -->')).toMatchObject({
      left: { content: 'A' },
      right: { content: 'B\n<!-- col -->\nC' },
    });
  });
});

it('joins blocks with one canonical separator', () => {
  expect(roundTrip('A\n\n\n<!-- block -->\nB')).toBe(`A${SEPARATOR}B`);
});

import {
  MAX_WIREFRAME_FILE_SIZE,
  WireframeFileError,
  createWireframeDownload,
  readWireframeFile,
  safeWireframeFilename,
} from './file-io';
import { createEmptyDocument } from './model';

function createFile(content: string, name = 'wireframe.json'): File {
  return new File([content], name, { type: 'application/json' });
}

describe('wireframe file IO', () => {
  it('sanitizes filenames and adds the JSON extension', () => {
    expect(safeWireframeFilename(' Dashboard:/runs?.json ')).toBe('Dashboard--runs-.json');
    expect(safeWireframeFilename('')).toBe('wireframe.json');
    expect(safeWireframeFilename('x'.repeat(120))).toHaveLength(101);
  });

  it('reads and validates a JSON file', async () => {
    const file = createFile(
      JSON.stringify({
        version: 1,
        name: 'Importada',
        grid: { columns: 12, rowHeight: 40 },
        blocks: [],
      }),
    );

    await expect(readWireframeFile(file)).resolves.toEqual(createEmptyDocument('Importada'));
  });

  it('rejects oversized, malformed and schema-invalid files', async () => {
    const oversized = createFile('x'.repeat(MAX_WIREFRAME_FILE_SIZE + 1));

    await expect(readWireframeFile(oversized)).rejects.toThrow(WireframeFileError);
    await expect(readWireframeFile(createFile('{bad'))).rejects.toThrow(/JSON válido/);
    await expect(readWireframeFile(createFile(JSON.stringify({ version: 2 })))).rejects.toThrow(
      /formato de wireframe/,
    );
  });

  it('creates a JSON download and revokes its temporary URL', () => {
    const anchor = window.document.createElement('a');
    const clicked = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const environment = {
      createObjectURL: vi.fn(() => 'blob:wireframe'),
      revokeObjectURL: vi.fn(),
      createAnchor: vi.fn(() => anchor),
      appendAnchor: vi.fn(),
      removeAnchor: vi.fn(),
    };

    createWireframeDownload(createEmptyDocument('Mi pantalla'), environment);

    expect(environment.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchor.download).toBe('Mi pantalla.json');
    expect(anchor.href).toContain('blob:wireframe');
    expect(clicked).toHaveBeenCalledOnce();
    expect(environment.removeAnchor).toHaveBeenCalledWith(anchor);
    expect(environment.revokeObjectURL).toHaveBeenCalledWith('blob:wireframe');
  });
});

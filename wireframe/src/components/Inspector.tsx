import type { ChangeEvent } from 'react';
import type { WireframeBlockV1 } from '../model';

interface InspectorProps {
  block: WireframeBlockV1 | null;
  onTextChange: (field: 'title' | 'description', value: string) => void;
  onGeometryChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function Inspector({
  block,
  onTextChange,
  onGeometryChange,
  onDuplicate,
  onDelete,
}: InspectorProps) {
  if (!block) {
    return (
      <aside className="inspector-panel" aria-labelledby="inspector-title">
        <p className="panel-kicker">Inspector</p>
        <h2 id="inspector-title">Ningún bloque seleccionado</h2>
        <p className="inspector-empty">
          Selecciona un bloque del lienzo para editar su contenido y tamaño.
        </p>
      </aside>
    );
  }

  return (
    <aside className="inspector-panel" aria-labelledby="inspector-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Inspector</p>
          <h2 id="inspector-title">Propiedades del bloque</h2>
        </div>
      </div>
      <div className="inspector-fields">
        <label>
          <span>Título</span>
          <input
            value={block.title}
            maxLength={120}
            onChange={(event) => onTextChange('title', event.target.value)}
          />
        </label>
        <label>
          <span>Descripción</span>
          <textarea
            value={block.description}
            maxLength={4000}
            rows={6}
            onChange={(event) => onTextChange('description', event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Posición y tamaño</legend>
          <div className="geometry-fields">
            <GeometryInput
              label="Columna"
              value={block.x}
              onChange={(value) => onGeometryChange('x', value)}
            />
            <GeometryInput
              label="Fila"
              value={block.y}
              onChange={(value) => onGeometryChange('y', value)}
            />
            <GeometryInput
              label="Ancho"
              value={block.width}
              onChange={(value) => onGeometryChange('width', value)}
            />
            <GeometryInput
              label="Alto"
              value={block.height}
              onChange={(value) => onGeometryChange('height', value)}
            />
          </div>
        </fieldset>
      </div>
      <div className="inspector-actions">
        <button type="button" onClick={onDuplicate}>
          Duplicar
        </button>
        <button type="button" className="danger-action" onClick={onDelete}>
          Eliminar
        </button>
      </div>
    </aside>
  );
}

interface GeometryInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function GeometryInput({ label, value, onChange }: GeometryInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    onChange(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <label>
      <span>{label}</span>
      <input type="number" min={0} value={value} onChange={handleChange} />
    </label>
  );
}

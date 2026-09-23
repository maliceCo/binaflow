import type { ChangeEvent } from 'react';
import type { WireframeBlockV2 } from '../model';

interface InspectorProps {
  block: WireframeBlockV2 | null;
  parent: WireframeBlockV2 | null;
  childCount: number;
  parentOptions: WireframeBlockV2[];
  onTextChange: (field: 'title' | 'description', value: string) => void;
  onGeometryChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void;
  onAddChild: () => void;
  onMoveToParent: (parentId: string | null) => void;
  onSelectParent: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function Inspector({
  block,
  parent,
  childCount,
  parentOptions,
  onTextChange,
  onGeometryChange,
  onAddChild,
  onMoveToParent,
  onSelectParent,
  onDuplicate,
  onDelete,
}: InspectorProps) {
  if (!block) {
    return (
      <aside className="inspector-panel" aria-labelledby="inspector-title">
        <p className="panel-kicker">Inspector</p>
        <h2 id="inspector-title">Ningún bloque seleccionado</h2>
        <p className="inspector-empty">
          Selecciona un bloque para editar contenido, jerarquía y tamaño.
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
        <div className="hierarchy-status">
          {parent ? (
            <>
              <span>
                Dentro de: <strong>{parent.title || 'Bloque sin título'}</strong>
              </span>
              <button type="button" onClick={onSelectParent}>
                Seleccionar padre
              </button>
            </>
          ) : (
            <span>
              Bloque raíz · {childCount} {childCount === 1 ? 'bloque hijo' : 'bloques hijos'}
            </span>
          )}
          <small>
            La relación se guarda en JSON como parentId. Las coordenadas de un hijo son relativas al
            padre.
          </small>
        </div>
        {childCount === 0 && parentOptions.length > 0 && (
          <label>
            <span>Contenedor</span>
            <select
              aria-label="Contenedor del bloque"
              value={block.parentId ?? ''}
              onChange={(event) => onMoveToParent(event.target.value || null)}
            >
              <option value="">Raíz del lienzo</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title || 'Bloque sin título'}
                </option>
              ))}
            </select>
          </label>
        )}
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
          <legend>
            Posición y tamaño {parent ? '(relativos al padre)' : '(relativos al lienzo)'}
          </legend>
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
        {!parent && (
          <button type="button" onClick={onAddChild}>
            Añadir dentro
          </button>
        )}
        <button type="button" onClick={onDuplicate}>
          Duplicar
        </button>
        <button type="button" className="danger-action" onClick={onDelete}>
          Eliminar{childCount > 0 ? ' grupo' : ''}
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

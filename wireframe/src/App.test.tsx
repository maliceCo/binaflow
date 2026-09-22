import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the initial editor layout', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Diseño de pantalla' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ningún bloque seleccionado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir bloque' })).toBeEnabled();
  });

  it('creates, selects and edits a block from the inspector', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Añadir bloque' }));
    const block = screen.getByRole('button', { name: /Nuevo bloque/ });
    await user.click(block);

    const title = screen.getByLabelText('Título');
    const description = screen.getByLabelText('Descripción');
    await user.clear(title);
    await user.type(title, '<Panel>');
    await user.type(description, 'Mostrar el estado del run.');

    expect(title).toHaveValue('<Panel>');
    expect(description).toHaveValue('Mostrar el estado del run.');
    expect(screen.getByText('<Panel>')).toBeInTheDocument();
  });

  it('edits geometry, duplicates and deletes the selected block', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Añadir bloque' }));
    const original = screen.getByRole('button', { name: /Nuevo bloque/ });
    await user.click(original);
    await user.clear(screen.getByLabelText('Ancho'));
    await user.type(screen.getByLabelText('Ancho'), '6');
    await user.click(screen.getByRole('button', { name: 'Duplicar' }));

    expect(screen.getAllByRole('button', { name: /Nuevo bloque/ })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(screen.getByRole('heading', { name: 'Ningún bloque seleccionado' })).toBeInTheDocument();
  });

  it('renames the document and starts a new one', async () => {
    const user = userEvent.setup();
    render(<App />);

    const name = screen.getByLabelText('Nombre del wireframe');
    await user.clear(name);
    await user.type(name, 'Dashboard de runs');
    expect(name).toHaveValue('Dashboard de runs');

    await user.click(screen.getByRole('button', { name: 'Nuevo' }));
    expect(screen.getByLabelText('Nombre del wireframe')).toHaveValue('Nueva pantalla');
  });

  it('keeps the current document when creating a new one is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Añadir bloque' }));
    await user.click(screen.getByRole('button', { name: 'Nuevo' }));

    expect(screen.getByRole('button', { name: /Nuevo bloque/ })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('clears the current document after confirming a new one', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Añadir bloque' }));
    await user.click(screen.getByRole('button', { name: 'Nuevo' }));

    expect(screen.queryByRole('button', { name: /Nuevo bloque/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del wireframe')).toHaveValue('Nueva pantalla');
    vi.restoreAllMocks();
  });

  it('imports a valid JSON document and keeps the current one after an error', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Añadir bloque' }));
    const input = screen.getByLabelText('Importar JSON');
    await user.upload(
      input,
      new File(
        [
          JSON.stringify({
            version: 1,
            name: 'Importada',
            grid: { columns: 12, rowHeight: 40 },
            blocks: [],
          }),
        ],
        'importada.json',
        { type: 'application/json' },
      ),
    );

    expect(await screen.findByLabelText('Nombre del wireframe')).toHaveValue('Importada');
    expect(screen.queryByRole('button', { name: /Nuevo bloque/ })).not.toBeInTheDocument();

    await user.upload(input, new File(['{bad'], 'invalida.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('JSON válido');
    expect(screen.getByLabelText('Nombre del wireframe')).toHaveValue('Importada');
  });
});

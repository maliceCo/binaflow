import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
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
});

import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the initial wireframe heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Wireframe', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Tu espacio para diseñar pantallas' }),
    ).toBeInTheDocument();
  });
});

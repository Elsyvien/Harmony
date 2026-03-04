import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { AuthForm } from '../src/components/auth-form';

describe('privacy policy surfaces', () => {
  it('renders the privacy policy page route', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/Version/i)).toBeInTheDocument();
  });

  it('shows privacy policy link in auth form', () => {
    render(
      <MemoryRouter>
        <AuthForm
          mode="login"
          loading={false}
          error={null}
          switchCopy="No account yet?"
          switchHref="/register"
          switchLabel="Create one"
          onSubmit={async () => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });
});

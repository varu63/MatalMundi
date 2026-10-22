import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Login from './Login';

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ login: loginMock }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<LocationProbe />} />
        <Route path="/admin" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

async function submitLogin() {
  await userEvent.type(screen.getByLabelText(/email/i), 'admin@metalmundi.test');
  await userEvent.type(screen.getByLabelText(/password/i), 'Password123');
  await userEvent.click(screen.getByRole('button', { name: /^log in$/i }));
}

describe('Login redirect', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('sends a regular user to the dashboard', async () => {
    loginMock.mockResolvedValue({ role: 'USER' });
    renderLogin();
    await submitLogin();
    expect(await screen.findByTestId('location')).toHaveTextContent('/dashboard');
  });

  it('sends an admin to the control centre', async () => {
    loginMock.mockResolvedValue({ role: 'ADMIN' });
    renderLogin();
    await submitLogin();
    expect(await screen.findByTestId('location')).toHaveTextContent('/admin');
  });

  it('shows the server error message when the login fails', async () => {
    loginMock.mockRejectedValue({ response: { data: { message: 'Invalid email or password' } } });
    renderLogin();
    await submitLogin();
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
  });
});

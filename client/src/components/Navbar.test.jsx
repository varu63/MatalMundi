import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Navbar from './Navbar';

const { logoutMock, userRef } = vi.hoisted(() => ({
  logoutMock: vi.fn().mockResolvedValue(undefined),
  userRef: { current: null },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: userRef.current, logout: logoutMock }),
}));

vi.mock('../context/CartContext', () => ({
  useCart: () => ({ items: [] }),
}));

vi.mock('../context/SidebarContext', () => ({
  useSidebar: () => ({ isOpen: false, toggle: vi.fn() }),
}));

function renderNavbar() {
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>
  );
}

describe('Navbar account menu', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    userRef.current = { name: 'Asha Rao', email: 'asha@example.com', role: 'USER' };
  });

  it('renders an account menu button for a signed-in user', () => {
    renderNavbar();
    expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument();
  });

  it('opens the account menu when the user button is clicked', async () => {
    renderNavbar();
    const trigger = screen.getByRole('button', { name: /account menu/i });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('exposes working account links inside the menu', async () => {
    renderNavbar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

    const dashboard = await screen.findByRole('menuitem', { name: /dashboard/i });
    expect(dashboard).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('menuitem', { name: /my orders/i })).toHaveAttribute(
      'href',
      '/dashboard/orders'
    );
    expect(screen.queryByRole('menuitem', { name: /admin console/i })).not.toBeInTheDocument();
  });

  it('shows the admin console link for an admin', async () => {
    userRef.current = { name: 'Admin User', email: 'admin@example.com', role: 'ADMIN' };
    renderNavbar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

    const adminLink = await screen.findByRole('menuitem', { name: /admin console/i });
    expect(adminLink).toHaveAttribute('href', '/admin');
  });

  it('closes the menu on Escape', async () => {
    renderNavbar();
    const trigger = screen.getByRole('button', { name: /account menu/i });
    await userEvent.click(trigger);
    await screen.findByRole('menu');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the account menu for anonymous visitors', () => {
    userRef.current = null;
    renderNavbar();
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log in/i })).toBeInTheDocument();
  });
});

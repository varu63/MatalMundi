import { Link } from 'react-router-dom';
import { Recycle } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-ink-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Recycle className="h-4 w-4" />
          </span>
          <span className="font-semibold text-ink-800">MetalMundi</span>
        </div>
        <p className="text-center">Turn scrap into value — responsibly.</p>
        <div className="flex gap-4">
          <Link to="/marketplace" className="hover:text-brand-600">
            Marketplace
          </Link>
          <Link to="/register" className="hover:text-brand-600">
            Become a seller
          </Link>
        </div>
      </div>
    </footer>
  );
}

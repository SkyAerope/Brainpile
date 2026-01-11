import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

export const Layout: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  // Determine mode from path
  const mode = location.pathname === '/' ? 'timeline' : 
               location.pathname === '/random' ? 'random' : 
               location.pathname.startsWith('/entities') ? 'entities' :
               location.pathname.startsWith('/tags') ? 'tags' : 'timeline';

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
        navigate(`/?search=${encodeURIComponent(searchInput)}`);
    }
  };

  const clearSearch = () => {
    setSearchInput('');
    navigate('/');
  };

  const hasDrawerPage = location.pathname.startsWith('/entities') || location.pathname.startsWith('/tags');

  return (
    <div className={`app-layout ${hasDrawerPage ? 'has-drawer' : ''}`}>
      <Sidebar mode={mode as any} />
      
      <main className="main-layout">
        <Header 
          searchInput={searchInput} 
          setSearchInput={setSearchInput} 
          onSearch={handleSearch} 
          clearSearch={clearSearch} 
        />
        <Outlet />
      </main>
    </div>
  );
};

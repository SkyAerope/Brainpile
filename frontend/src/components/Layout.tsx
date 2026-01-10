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
               location.pathname.startsWith('/entities') ? 'entities' : 'timeline';

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

  const isEntitiesPage = location.pathname.startsWith('/entities');

  return (
    <div className={`app-layout ${isEntitiesPage ? 'has-drawer' : ''}`}>
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

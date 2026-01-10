import React from 'react';
import { Search, Bell, MessageCircle, User } from 'lucide-react';

interface HeaderProps {
  searchInput: string;
  setSearchInput: (val: string) => void;
  onSearch: (e: React.FormEvent) => void;
  clearSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({ searchInput, setSearchInput, onSearch, clearSearch }) => {
  return (
    <header className="header">
      <form className="search-container" onSubmit={onSearch}>
        <Search className="search-icon" size={20} />
        <input
          type="text"
          className="search-input"
          placeholder="Search for ideas..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchInput && (
          <button type="button" className="btn-icon" onClick={clearSearch}>✕</button>
        )}
      </form>

      <div className="user-menu">
        <button className="btn-icon"><Bell size={24} /></button>
        <button className="btn-icon"><MessageCircle size={24} /></button>
        <button className="btn-icon"><User size={24} /></button>
      </div>
    </header>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Search, Bell, MessageCircle, User } from 'lucide-react';

interface HeaderProps {
  searchInput: string;
  setSearchInput: (val: string) => void;
  onSearch: (e: React.FormEvent) => void;
  clearSearch: () => void;
  /** 抽屉页空间有限：搜索默认收为图标按钮，点击展开，点击空白处收回。 */
  collapsible?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ searchInput, setSearchInput, onSearch, clearSearch, collapsible = false }) => {
  const [expanded, setExpanded] = useState(false);
  const searchRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 折叠模式下：展开后聚焦输入框；点击空白处或 Esc 收回（有内容时保持展开）。
  useEffect(() => {
    if (!collapsible || !expanded) return;

    inputRef.current?.focus();

    const handlePointerDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        if (!searchInput) setExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [collapsible, expanded, searchInput]);

  // 离开折叠模式（切到非抽屉页）时重置展开状态。
  useEffect(() => {
    if (!collapsible) setExpanded(false);
  }, [collapsible]);

  const isCollapsed = collapsible && !expanded;

  return (
    <header className={`header ${collapsible ? 'header-collapsible' : ''} ${expanded ? 'search-expanded' : ''}`}>
      {isCollapsed ? (
        <button
          type="button"
          className="btn-icon search-toggle"
          aria-label="Search"
          onClick={() => setExpanded(true)}
        >
          <Search size={20} />
        </button>
      ) : (
        <form className="search-container" onSubmit={onSearch} ref={searchRef}>
          <Search className="search-icon" size={20} />
          <input
            ref={inputRef}
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
      )}

      <div className="user-menu">
        <button className="btn-icon"><Bell size={24} /></button>
        <button className="btn-icon"><MessageCircle size={24} /></button>
        <button className="btn-icon"><User size={24} /></button>
      </div>
    </header>
  );
};

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, Bell, MessageCircle, User } from 'lucide-react';

interface HeaderProps {
  searchInput: string;
  setSearchInput: (val: string) => void;
  onSearch: (e: React.FormEvent) => void;
  clearSearch: () => void;
}

// 完整展开的搜索框 + 右侧图标所需的最小宽度（含 padding/gap）。
// header 可用宽度小于此值时，搜索收为圆形图标按钮，点击展开。
const FULL_LAYOUT_MIN_WIDTH = 420;

export const Header: React.FC<HeaderProps> = ({ searchInput, setSearchInput, onSearch, clearSearch }) => {
  const headerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 是否因空间不足需要折叠（按实际宽度判断，而非页面）。
  const [needsCollapse, setNeedsCollapse] = useState(false);
  // 折叠状态下用户是否已点击展开。
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const measure = () => {
      setNeedsCollapse(el.clientWidth < FULL_LAYOUT_MIN_WIDTH);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 不再需要折叠时，重置展开状态。
  useEffect(() => {
    if (!needsCollapse) setExpanded(false);
  }, [needsCollapse]);

  // 折叠并展开后：聚焦输入框；点击空白处或 Esc 收回（有内容时保持展开）。
  useEffect(() => {
    if (!needsCollapse || !expanded) return;

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
  }, [needsCollapse, expanded, searchInput]);

  // collapsed: 折叠且未展开（圆形图标按钮态）
  const collapsed = needsCollapse && !expanded;
  // searchOpen: 折叠模式下已展开为搜索框
  const searchOpen = needsCollapse && expanded;

  const headerClass = [
    'header',
    needsCollapse ? 'header-collapsible' : '',
    collapsed ? 'search-collapsed' : '',
    searchOpen ? 'search-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleSearchClick = () => {
    if (collapsed) setExpanded(true);
  };

  return (
    <header className={headerClass} ref={headerRef}>
      <form className="search-container" onSubmit={onSearch} ref={searchRef}>
        {/* 搜索图标全程固定在左侧；折叠时点击它展开搜索框 */}
        <button
          type="button"
          className="search-icon-btn"
          aria-label="Search"
          onClick={handleSearchClick}
          tabIndex={collapsed ? 0 : -1}
        >
          <Search className="search-icon" size={20} />
        </button>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search for ideas..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          tabIndex={collapsed ? -1 : 0}
        />
        {searchInput && !collapsed && (
          <button type="button" className="btn-icon search-clear" onClick={clearSearch}>✕</button>
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

import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Shuffle, Users, Settings } from 'lucide-react';
import './Sidebar.css';

interface SidebarProps {
  mode: 'timeline' | 'random' | 'search' | 'entities';
}

export const Sidebar: React.FC<SidebarProps> = ({ mode }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Link to="/">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="#e60023">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.42 7.62 11.17-.1-.95-.19-2.42.04-3.46.21-.93 1.34-5.71 1.34-5.71s-.34-.68-.34-1.69c0-1.58.92-2.76 2.06-2.76 0.97 0 1.44.73 1.44 1.61 0 0.98-.62 2.44-.94 3.79-.27 1.13.56 2.06 1.68 2.06 2.02 0 3.57-2.13 3.57-5.21 0-2.72-1.96-4.63-4.75-4.63-3.24 0-5.14 2.43-5.14 4.94 0 0.98.38 2.03.85 2.59.09.11.11.21.08.32-.09.37-.29 1.18-.33 1.35-.05.21-.17.26-.4.15-1.48-.69-2.41-2.85-2.41-4.59 0-3.74 2.71-7.18 7.84-7.18 4.12 0 7.32 2.93 7.32 6.85 0 4.1-2.58 7.39-6.17 7.39-1.21 0-2.34-.63-2.73-1.37l-.74 2.82c-.27 1.03-.99 2.32-1.48 3.12 1.12.35 2.31.54 3.54.54 6.63 0 12-5.37 12-12S18.63 0 12 0z" />
          </svg>
        </Link>
      </div>
      <nav className="sidebar-nav">
        <Link 
          to="/"
          className={`nav-item ${mode === 'timeline' ? 'active' : ''}`} 
          title="Timeline"
        >
          <Clock size={24} />
        </Link>
        <Link 
          to="/random"
          className={`nav-item ${mode === 'random' ? 'active' : ''}`} 
          title="Random"
        >
          <Shuffle size={24} />
        </Link>
        <Link 
          to="/entities"
          className={`nav-item ${mode === 'entities' ? 'active' : ''}`} 
          title="Entities"
        >
          <Users size={24} />
        </Link>
      </nav>
      <div className="sidebar-footer">
        <div className="nav-item" title="Settings">
          <Settings size={24} />
        </div>
      </div>
    </aside>
  );
};

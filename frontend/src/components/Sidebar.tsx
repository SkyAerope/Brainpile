import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Shuffle, Users, Tag, Settings } from 'lucide-react';
import icon from '../assets/icon.svg';
import './Sidebar.css';

interface SidebarProps {
  mode: 'timeline' | 'random' | 'search' | 'entities' | 'tags';
}

export const Sidebar: React.FC<SidebarProps> = ({ mode }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Link to="/">
          <img src={icon} alt="Brainpile" width="32" height="32" />
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
        <Link 
          to="/tags"
          className={`nav-item ${mode === 'tags' ? 'active' : ''}`} 
          title="Tags"
        >
          <Tag size={24} />
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

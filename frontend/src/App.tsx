import { useEffect, useState, useRef, useMemo, useSyncExternalStore } from 'react';
import { fetchItems, searchItems, Item } from './api';
import { ItemCard } from './components/ItemCard';
import { ItemModal } from './components/ItemModal';
import { Search, Clock, Shuffle, Settings, Bell, MessageCircle, User } from 'lucide-react';

function useWindowWidth() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('resize', onStoreChange);
      return () => window.removeEventListener('resize', onStoreChange);
    },
    () => typeof window !== 'undefined' ? window.innerWidth : 1200
  );
}

function getColumnCount(width: number) {
  if (width < 500) return 1;
  if (width < 700) return 2;
  if (width < 1100) return 3;
  if (width < 1500) return 4;
  return 5;
}

function estimateHeight(item: Item) {
  let score = 0;
  if (item.width && item.height) {
    // Height relative to width. 1000 is a scale factor.
    score += (item.height / item.width) * 1000;
  } else if (item.type !== 'text') {
    // Default image height if missing dimensions
    score += 600;
  }
  if (item.content) {
    // Rough estimation of text height
    score += Math.min(item.content.length * 1.5, 200);
  }
  return score + 100; // Base height for meta and padding
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'timeline' | 'random' | 'search'>('timeline');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const initialized = useRef(false);

  const windowWidth = useWindowWidth();
  const columnCount = getColumnCount(windowWidth - 80); // Adjust for sidebar

  const columns = useMemo(() => {
    const cols: Item[][] = Array.from({ length: columnCount }, () => []);
    const heights = new Array(columnCount).fill(0);

    items.forEach((item) => {
      // Find the index of the shortest column
      let minHeight = heights[0];
      let minIdx = 0;
      for (let i = 1; i < columnCount; i++) {
        if (heights[i] < minHeight) {
          minHeight = heights[i];
          minIdx = i;
        }
      }
      
      cols[minIdx].push(item);
      heights[minIdx] += estimateHeight(item);
    });

    return cols;
  }, [items, columnCount]);

  // Load items
  const loadItems = async (reset = false) => {
    if (loading || (mode === 'search' && !reset)) return;
    setLoading(true);
    try {
      const currentCursor = reset ? null : cursor;
      const data = await fetchItems(currentCursor, mode === 'timeline' ? 'timeline' : 'random');
      
      if (reset) {
        setItems(data.items);
      } else {
        setItems(prev => [...prev, ...data.items]);
      }
      setCursor(data.next_cursor);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialized.current) {
        initialized.current = true;
        loadItems(true);
    }
  }, []);

  const handleModeChange = (newMode: 'timeline' | 'random') => {
    if (newMode === mode) return;
    setMode(newMode);
    setSearchQuery('');
    setSearchInput('');
    setCursor(null);
    setItems([]);
    setTimeout(() => {
        fetchItems(null, newMode).then(data => {
            setItems(data.items);
            setCursor(data.next_cursor);
        });
    }, 0);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    
    setLoading(true);
    setMode('search');
    setSearchQuery(searchInput);
    setCursor(null);
    
    try {
      const data = await searchItems(searchInput);
      setItems(data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchInput('');
    setMode('timeline');
    setCursor(null);
    setItems([]);
    fetchItems(null, 'timeline').then(data => {
      setItems(data.items);
      setCursor(data.next_cursor);
    });
  };

  const handleDeleted = (id: number) => {
    setItems(items.filter(i => i.id !== id));
  };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.42 7.62 11.17-.1-.95-.19-2.42.04-3.46.21-.93 1.34-5.71 1.34-5.71s-.34-.68-.34-1.69c0-1.58.92-2.76 2.06-2.76 0.97 0 1.44.73 1.44 1.61 0 0.98-.62 2.44-.94 3.79-.27 1.13.56 2.06 1.68 2.06 2.02 0 3.57-2.13 3.57-5.21 0-2.72-1.96-4.63-4.75-4.63-3.24 0-5.14 2.43-5.14 4.94 0 0.98.38 2.03.85 2.59.09.11.11.21.08.32-.09.37-.29 1.18-.33 1.35-.05.21-.17.26-.4.15-1.48-.69-2.41-2.85-2.41-4.59 0-3.74 2.71-7.18 7.84-7.18 4.12 0 7.32 2.93 7.32 6.85 0 4.1-2.58 7.39-6.17 7.39-1.21 0-2.34-.63-2.73-1.37l-.74 2.82c-.27 1.03-.99 2.32-1.48 3.12 1.12.35 2.31.54 3.54.54 6.63 0 12-5.37 12-12S18.63 0 12 0z" />
          </svg>
        </div>
        <nav className="sidebar-nav">
          <div 
            className={`nav-item ${mode === 'timeline' ? 'active' : ''}`} 
            onClick={() => handleModeChange('timeline')}
            title="Timeline"
          >
            <Clock size={24} />
          </div>
          <div 
            className={`nav-item ${mode === 'random' ? 'active' : ''}`} 
            onClick={() => handleModeChange('random')}
            title="Random"
          >
            <Shuffle size={24} />
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="nav-item" title="Settings">
            <Settings size={24} />
          </div>
        </div>
      </aside>

      <main className="main-layout">
        <header className="header">
          <form className="search-container" onSubmit={handleSearch}>
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

        <div className="container">
          {mode === 'search' && searchQuery && (
            <div style={{ padding: '16px 0', color: 'var(--text-secondary)' }}>
              Searching for: <strong>{searchQuery}</strong> ({items.length} results)
            </div>
          )}

          <div className="my-masonry-grid">
            {columns.map((colItems, i) => (
              <div key={i} className="my-masonry-grid_column" style={{ flex: 1 }}>
                {colItems.map(item => (
                  <div key={item.id} style={{ marginBottom: '16px' }}>
                    <ItemCard item={item} onClick={() => setSelectedItemId(item.id)} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ padding: '2rem', textAlign: 'center' }}>
              {loading ? (
                  <span style={{color: '#71717a'}}>Loading...</span>
              ) : (
                  (cursor || mode === 'random') && mode !== 'search' && (
                      <button className="btn btn-secondary" onClick={() => loadItems(false)} style={{ borderRadius: '24px' }}>
                          Load More
                      </button>
                  )
              )}
              {!loading && items.length === 0 && (
                  <span style={{color: '#71717a'}}>No items found.</span>
              )}
          </div>
        </div>
      </main>

      {selectedItemId && (
        <ItemModal 
            itemId={selectedItemId} 
            onClose={() => setSelectedItemId(null)} 
            onDeleted={handleDeleted}
        />
      )}
    </>
  );
}

export default App;

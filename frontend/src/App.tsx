import { useEffect, useState, useRef } from 'react';
import Masonry from 'react-masonry-css';
import { fetchItems, searchItems, Item } from './api';
import { ItemCard } from './components/ItemCard';
import { ItemModal } from './components/ItemModal';

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'timeline' | 'random' | 'search'>('timeline');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const initialized = useRef(false);

  // Load items
  const loadItems = async (reset = false) => {
    if (loading || mode === 'search') return;
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
    <div className="container">
      <header className="header">
        <h1>Brainpile</h1>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', flex: 1, maxWidth: '400px' }}>
          <input
            type="text"
            placeholder="Search..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              fontSize: '14px',
            }}
          />
          <button type="submit" className="btn" disabled={loading}>
            Search
          </button>
        </form>
        <div style={{ display: 'flex', gap: '10px' }}>
             {mode === 'search' && (
               <button className="btn btn-secondary" onClick={clearSearch}>
                 ✕ Clear
               </button>
             )}
             <button 
                className={`btn ${mode === 'timeline' ? '' : 'btn-secondary'}`}
                onClick={() => handleModeChange('timeline')}
                disabled={mode === 'search'}
             >
                Timeline
             </button>
             <button 
                className={`btn ${mode === 'random' ? '' : 'btn-secondary'}`}
                onClick={() => handleModeChange('random')}
                disabled={mode === 'search'}
             >
                Random
             </button>
        </div>
      </header>

      {mode === 'search' && searchQuery && (
        <div style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>
          Searching for: <strong>{searchQuery}</strong> ({items.length} results)
        </div>
      )}

      <Masonry
        breakpointCols={{
          default: 4,
          1100: 3,
          700: 2,
          500: 1
        }}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {items.map(item => (
          <div key={item.id} style={{ marginBottom: '20px' }}>
            <ItemCard item={item} onClick={() => setSelectedItemId(item.id)} />
          </div>
        ))}
      </Masonry>

      {/* Infinite Scroll trigger / Load More */}
      <div style={{ padding: '2rem', textAlign: 'center' }}>
          {loading ? (
              <span style={{color: '#71717a'}}>Loading items...</span>
          ) : mode === 'search' ? (
              items.length === 0 && <span style={{color: '#71717a'}}>No results found.</span>
          ) : (
              (cursor || mode === 'random') && (
                  <button className="btn btn-secondary" onClick={() => loadItems(false)}>
                      Load More
                  </button>
              )
          )}
          {!loading && !cursor && mode !== 'random' && mode !== 'search' && items.length > 0 && (
              <span style={{color: '#71717a'}}>No more items.</span>
          )}
          {!loading && items.length === 0 && mode !== 'search' && (
              <span style={{color: '#71717a'}}>No items found. Import some data!</span>
          )}
      </div>

      {selectedItemId && (
        <ItemModal 
            itemId={selectedItemId} 
            onClose={() => setSelectedItemId(null)} 
            onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

export default App;

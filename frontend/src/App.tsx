import { useEffect, useState, useRef } from 'react';
import { fetchItems, Item } from './api';
import { ItemCard } from './components/ItemCard';
import { ItemModal } from './components/ItemModal';

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'timeline' | 'random'>('timeline');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const initialized = useRef(false);

  // Load items
  const loadItems = async (reset = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const currentCursor = reset ? null : cursor;
      const data = await fetchItems(currentCursor, mode);
      
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
    setCursor(null);
    setItems([]);
    // State updates are batched, but we need to trigger re-fetch.
    // Effect dependency or direct call? 
    // Let's reset and call loadItems in next tick.
    setTimeout(() => {
        // We need to bypass the closure staleness of mode/cursor here, but loadItems reads state?
        // Actually loadItems reads state current values? No, closures. 
        // Better to just rely on an effect or pass params.
        fetchItems(null, newMode).then(data => {
            setItems(data.items);
            setCursor(data.next_cursor);
        });
    }, 0);
  };

  const handleDeleted = (id: number) => {
    setItems(items.filter(i => i.id !== id));
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Brainpile</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
             <button 
                className={`btn ${mode === 'timeline' ? '' : 'btn-secondary'}`}
                onClick={() => handleModeChange('timeline')}
             >
                Timeline
             </button>
             <button 
                className={`btn ${mode === 'random' ? '' : 'btn-secondary'}`}
                onClick={() => handleModeChange('random')}
             >
                Random
             </button>
        </div>
      </header>

      <div className="grid">
        {items.map(item => (
          <ItemCard key={item.id} item={item} onClick={() => setSelectedItemId(item.id)} />
        ))}
      </div>

      {/* Infinite Scroll trigger / Load More */}
      <div style={{ padding: '2rem', textAlign: 'center' }}>
          {loading ? (
              <span style={{color: '#71717a'}}>Loading items...</span>
          ) : (
              (cursor || mode === 'random') && (
                  <button className="btn btn-secondary" onClick={() => loadItems(false)}>
                      Load More
                  </button>
              )
          )}
          {!loading && !cursor && mode !== 'random' && items.length > 0 && (
              <span style={{color: '#71717a'}}>No more items.</span>
          )}
          {!loading && items.length === 0 && (
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

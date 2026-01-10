import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TimelinePage } from './pages/TimelinePage';
import { RandomPage } from './pages/RandomPage';
import { EntitiesPage } from './pages/EntitiesPage';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<TimelinePage />} />
          <Route path="random" element={<RandomPage />} />
          <Route path="entities" element={<EntitiesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

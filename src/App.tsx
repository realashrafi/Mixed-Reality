import {Route, BrowserRouter as Router, Routes} from "react-router-dom";
import './App.css';
import ARIntegrated from "./pages/MR/ARIntegrated";

function App() {
  return (
      <Router>
        <Routes>
          <Route path="/" element={<ARIntegrated/>}/>
        </Routes>
      </Router>
  );
}

export default App;

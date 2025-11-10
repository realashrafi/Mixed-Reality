import {Route, BrowserRouter as Router, Routes} from "react-router-dom";
import './App.css';
import ARIntegrated from "./pages/MR/ARIntegrated";
import ARIntegrated2 from "./pages/MR/v2/ARIntegrated2";

function App() {
  return (
      <Router>
        <Routes>
          {/*<Route path="/" element={<ARIntegrated/>}/>*/}
          <Route path="/" element={<ARIntegrated2 anchorImage={'/targets.mind'}/>}/>
        </Routes>
      </Router>
  );
}

export default App;

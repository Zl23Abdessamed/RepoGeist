import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "./app.css";
import AppProvider from "./components/AppProvider";

export default function App() {
  return (
    <Router
      root={props => (
        <>
          <Suspense>
            <AppProvider>{props.children}</AppProvider>
          </Suspense>
        </>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

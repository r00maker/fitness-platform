import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { StudioProvider } from "./lib/session";
import { StudioHome } from "./pages/StudioHome";
import { ClassPage } from "./pages/ClassPage";
import { SignIn } from "./pages/SignIn";
import { Join } from "./pages/Join";
import { Buy } from "./pages/Buy";
import { Account } from "./pages/Account";
import { PaymentReturn } from "./pages/Payments";

function Studio() {
  const { slug = "" } = useParams();
  return (
    <StudioProvider slug={slug}>
      <Routes>
        <Route index element={<StudioHome tab="classes" />} />
        <Route path="packages" element={<StudioHome tab="packages" />} />
        <Route path="packages/:planId" element={<Buy />} />
        <Route path="classes/:id" element={<ClassPage />} />
        <Route path="sign-in" element={<SignIn />} />
        <Route path="join" element={<Join />} />
        <Route path="me" element={<Account tab="bookings" />} />
        <Route path="me/packages" element={<Account tab="packages" />} />
        <Route path="me/payment" element={<Account tab="payment" />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </StudioProvider>
  );
}

function Home() {
  let last: string | null = null;
  try { last = localStorage.getItem("studio.last"); } catch { /* ignore */ }
  if (last) return <Navigate to={`/s/${last}`} replace />;
  return <div className="center"><h1>Book a class</h1><p className="muted">Open your studio's booking link to see its timetable.</p></div>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:slug/*" element={<Studio />} />
        <Route path="/payments/done" element={<PaymentReturn kind="done" />} />
        <Route path="/payments/cancelled" element={<PaymentReturn kind="cancelled" />} />
        <Route path="/payments/card-saved" element={<PaymentReturn kind="card-saved" />} />
        <Route path="*" element={<div className="center"><h1>Page not found</h1></div>} />
      </Routes>
    </BrowserRouter>
  );
}

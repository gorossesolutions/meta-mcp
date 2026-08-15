import { Routes, Route } from "react-router";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AuthPage } from "./pages/AuthPage";
import { RootPage } from "./pages/RootPage";
import { BusinessesPage } from "./pages/BusinessesPage";
import { AccountsPage } from "./pages/AccountsPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { AdsetsPage } from "./pages/AdsetsPage";
import { AdsPage } from "./pages/AdsPage";
import { AdDetailPage } from "./pages/AdDetailPage";
import { AnglesPage } from "./pages/AnglesPage";

export default function App() {
  return (
    <Routes>
      <Route path="/auth/:path" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RootPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId"
        element={
          <RequireAuth>
            <BusinessesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/angles"
        element={
          <RequireAuth>
            <AnglesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/businesses/:businessId"
        element={
          <RequireAuth>
            <AccountsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/accounts/:accountId"
        element={
          <RequireAuth>
            <CampaignsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/accounts/:accountId/campaigns/:campaignId"
        element={
          <RequireAuth>
            <AdsetsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/accounts/:accountId/campaigns/:campaignId/adsets/:adsetId"
        element={
          <RequireAuth>
            <AdsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/accounts/:accountId/campaigns/:campaignId/adsets/:adsetId/ads/:adId"
        element={
          <RequireAuth>
            <AdDetailPage />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

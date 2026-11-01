import Home from "./Pages/Home";
import { SecureLogin as Login } from "./Auth/SecureLogin";
import ProtectedRoute from "./Auth/ProtectedR";
import { Routes, Route, Navigate } from "react-router";
import Layout from "./Layout";
import CompaniesHome from "./Pages/companies/CompaniesHome";
import AddCompanies from "./Pages/companies/Forms/AddCompanies";
import EditCompanies from "./Pages/companies/Forms/EditCompanies";
import AddTemplate from "./Pages/Templates/Forms/AddTemplate";
import EditTemplate from "./Pages/Templates/Forms/EditTemplate";
import CopyRankPromotion from "./Pages/Templates/Forms/CopyRankPromotion";
import TemplateHome from "./Pages/Templates/TemplateHome";
import GraphiHome from "./Pages/Graphics/GraphiHome";
import AddGraphics from "./Pages/Graphics/Form/AddGraphics";
import EditGraphics from "./Pages/Graphics/Form/EditGraphics";
import MainTeam from "./Pages/Mteam/MainTeam";
import Removebg from "./Pages/Removebg/Removebg";
import UserDashboard from "./Pages/UserDashboard/UserDashboard";
import AdminManagement from "./Pages/AdminManagement/AdminManagement";
import Leads from "./Pages/Leads/Leads";
import TemplateData from "./Pages/Templates/TemplateData";
import SecuritySessions from "./Pages/SecuritySessions";
import TaskManagement from "./Pages/TaskManagement/TaskManagement";
import Notifications from "./Pages/Notifications/Notifications";
import DeleteRequests from "./Pages/DeleteRequests";
import { lazy } from "react";

const ExpenseManager = lazy(() => import("./Pages/ExpenseManager/ExpenseManager"));
const PopupManagement = lazy(() => import("./Pages/Popups/PopupManagement"));

import { useAdminAuth } from "./Auth/AdminAuthContext";
import { adminWorkspaceKey } from "./Utils/adminPageState.js";
import { RetainedAdminRoutes } from "./components/RetainedAdminViews.jsx";

const ADMIN_PAGES = [
  { path: "/", element: <Home /> },
  { path: "/companies", element: <CompaniesHome /> },
  { path: "/templates", aliases: ["/dashboard"], element: <TemplateHome /> },
  { path: "/graphics", element: <GraphiHome /> },
  { path: "/marketing", element: <MainTeam /> },
  { path: "/removebg", element: <Removebg /> },
  { path: "/userdashboard", element: <UserDashboard /> },
  { path: "/leads", element: <Leads /> },
  { path: "/templatedata", element: <TemplateData /> },
  { path: "/adminmanagement", element: <AdminManagement /> },
  { path: "/security", element: <SecuritySessions /> },
  { path: "/taskmanagement", element: <TaskManagement /> },
  { path: "/notifications", element: <Notifications /> },
  { path: "/delete-requests", element: <DeleteRequests /> },
  { path: "/expense", element: <ExpenseManager /> },
  { path: "/popups", element: <PopupManagement /> },
];

function AdminWorkspace() {
  return <Layout><RetainedAdminRoutes pages={ADMIN_PAGES}>
    <Routes>
      <Route path="/companies/add" element={<AddCompanies />} />
      <Route path="/companies/edit/:id" element={<EditCompanies />} />
      <Route path="/templates/add" element={<AddTemplate />} />
      <Route path="/templates/edit/:id" element={<EditTemplate />} />
      <Route path="/templates/copy-rank-promotion" element={<CopyRankPromotion />} />
      <Route path="/graphics/add" element={<AddGraphics />} />
      <Route path="/graphics/edit/:id" element={<EditGraphics />} />
    </Routes>
  </RetainedAdminRoutes></Layout>;
}

function AuthenticatedWorkspace() {
  const { session } = useAdminAuth();
  return <ProtectedRoute><AdminWorkspace key={adminWorkspaceKey(session)} /></ProtectedRoute>;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Navigate to="/login" replace />} />
    <Route path="/forgetpin" element={<Navigate to="/login" replace />} />
    <Route path="/*" element={<AuthenticatedWorkspace />} />
  </Routes>;
}

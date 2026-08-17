import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AuthGate } from './components/AuthGate'
import PipelinePage             from './pages/PipelinePage'
import { ProjectsPage, CompletedProjectsPage } from './pages/ProjectsPage'
import BudgetPage               from './pages/BudgetPage'
import ResourcesPage            from './pages/ResourcesPage'
import { IntegrationsPage }     from './pages/IntegrationsPage'
import { PermissionsPage }      from './pages/PermissionsPage'
import { AcceptInvitePage }     from './pages/AcceptInvitePage'

function CompletedPage() {
  return <CompletedProjectsPage/>
}

function MainApp() {
  return (
    <AuthGate>
      <Layout>
        <Routes>
          <Route path="/"                  element={<Navigate to="/upcoming-projects" replace/>}/>
          <Route path="/upcoming-projects" element={<PipelinePage/>}/>
          <Route path="/projects"          element={<ProjectsPage/>}/>
          <Route path="/completed"         element={<CompletedPage/>}/>
          <Route path="/resources"         element={<ResourcesPage/>}/>
          <Route path="/budget"            element={<BudgetPage/>}/>
          <Route path="/integrations"      element={<IntegrationsPage/>}/>
          <Route path="/permissions"       element={<PermissionsPage/>}/>
        </Routes>
      </Layout>
    </AuthGate>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Standalone — no sidebar, no AuthGate, since whoever's here has no
          identity/session yet at all — this page IS the entry point that
          establishes one. */}
      <Route path="/accept-invite/:token" element={<AcceptInvitePage/>}/>
      <Route path="/*" element={<MainApp/>}/>
    </Routes>
  )
}

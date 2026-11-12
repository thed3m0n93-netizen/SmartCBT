import { createBrowserRouter, Navigate } from "react-router";
import { useAuth } from "./AuthContext";
import AppLayout from "../layouts/AppLayout";
import LoginPage from "../pages/LoginPage";
import StudentRegisterPage from "../pages/StudentRegisterPage";
import DatabaseSetupPage from "../pages/DatabaseSetupPage";
import AdminDashboard from "../pages/admin/AdminDashboard";
import AdminNewsPage from "../pages/admin/AdminNewsPage";
import UsersPage from "../pages/admin/UsersPage";
import MasterDataPage from "../pages/admin/MasterDataPage";
import SettingsPage from "../pages/admin/SettingsPage";
import BackupRestorePage from "../pages/admin/BackupRestorePage";
import QuestionBankPage from "../pages/teacher/QuestionBankPage";
import ExamsPage from "../pages/teacher/ExamsPage";
import MonitoringPage from "../pages/teacher/MonitoringPage";
import GradingPage from "../pages/teacher/GradingPage";
import SEBConfigPage from "../pages/teacher/SEBConfigPage";
import TeacherLearningModulesPage from "../pages/teacher/LearningModulesPage";
import TeacherAssignmentsPage from "../pages/teacher/AssignmentsPage";
import StudentDataPage from "../pages/teacher/StudentDataPage";
import StudentDashboard from "../pages/student/StudentDashboard";
import NewsDetailPage from "../pages/student/NewsDetailPage";
import ExamTakingPage from "../pages/student/ExamTakingPage";
import StudentLearningModulesPage from "../pages/student/LearningModulesPage";
import LearningModuleDetailPage from "../pages/student/LearningModuleDetailPage";
import StudentAssignmentsPage from "../pages/student/AssignmentsPage";
import GameModeRedirect from "../pages/student/game_mode/GameModeRedirect";
import GameModePlay from "../pages/student/game_mode/GameModePlay";
import StoragePage from "../pages/StoragePage";
import ERaporSectionPage from "../pages/erapor/ERaporSectionPage";

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin/dashboard" replace />;
  if (user.role === "teacher") return <Navigate to="/teacher/questions" replace />;
  return <Navigate to="/student/dashboard" replace />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <StudentRegisterPage /> },
  { path: "/setup", element: <DatabaseSetupPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: "admin/dashboard", element: <AdminDashboard /> },
      { path: "admin/users", element: <UsersPage /> },
      { path: "admin/master-data", element: <MasterDataPage /> },
      { path: "admin/settings", element: <SettingsPage /> },
      { path: "admin/backup", element: <BackupRestorePage /> },
      { path: "admin/news", element: <AdminNewsPage /> },
      { path: "teacher/questions", element: <QuestionBankPage /> },
      { path: "teacher/exams", element: <ExamsPage /> },
      { path: "teacher/monitoring", element: <MonitoringPage /> },
      { path: "teacher/grading", element: <GradingPage /> },
      { path: "teacher/seb", element: <SEBConfigPage /> },
      { path: "teacher/modules", element: <TeacherLearningModulesPage /> },
      { path: "teacher/assignments", element: <TeacherAssignmentsPage /> },
      { path: "teacher/students", element: <StudentDataPage /> },
      { path: "student/dashboard", element: <StudentDashboard /> },
      // Detail berita dibuka dari slider headline di dashboard siswa. Path-nya
      // di luar `student/` karena staff juga boleh membuka draft untuk pratinjau.
      { path: "news/:newsId", element: <NewsDetailPage /> },
      { path: "student/exam/:examId", element: <ExamTakingPage /> },
      { path: "student/modules", element: <StudentLearningModulesPage /> },
      { path: "student/modules/:moduleId", element: <LearningModuleDetailPage /> },
      { path: "student/assignments", element: <StudentAssignmentsPage /> },
      { path: "student/game-mode", element: <GameModeRedirect /> },
      { path: "student/game-mode/play", element: <GameModePlay /> },
      { path: "storage", element: <StoragePage /> },
      // E-Rapor (§12 FEATURES.md) — placeholder per kategori; isinya diisi
      // bertahap sesuai tahap roadmap. Komponen membaca `:sectionId` sehingga
      // menambah kategori cukup menambah route-nya.
      { path: "erapor/:sectionId", element: <ERaporSectionPage /> },
    ],
  },
]);

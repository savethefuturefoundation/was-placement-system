// ============================================================
// src/lib/supabase.js — v3
// Add your project credentials here (same as before, unchanged)
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL      = 'https://imqcchpqdscfpqzzyvmt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltcWNjaHBxZHNjZnBxenp5dm10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTg5OTAsImV4cCI6MjA5NzczNDk5MH0.FAX8wYiaf3PHUiLenqeiFNC1AnQrsG5duzx1_m0bH-0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// AUTH HELPERS (unchanged from v1)
// ============================================================

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
  window.location.href = '/pages/login.html'
}

export async function getCurrentStaff() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('staff_profiles').select('*').eq('id', user.id).single()
  if (error) throw error
  return data
}

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { window.location.href = '/pages/login.html'; return null }
  return session
}

export async function requireRole(...allowedRoles) {
  await requireAuth()
  const staff = await getCurrentStaff()
  if (!staff || !allowedRoles.includes(staff.role)) { window.location.href = '/pages/dashboard.html'; return null }
  return staff
}

// ============================================================
// GRADE BAND HELPER — v3 (7 groups)
// ============================================================

export const GRADE_BANDS = [
  { code: 'PK3-PK4', label: 'Pre-K3 – Pre-K4', maxAge: 4 },
  { code: 'K-1',     label: 'Kindergarten – Grade 1', maxAge: 6 },
  { code: '2-3',     label: 'Grade 2 – Grade 3', maxAge: 8 },
  { code: '4-5',     label: 'Grade 4 – Grade 5', maxAge: 10 },
  { code: '6-7',     label: 'Grade 6 – Grade 7', maxAge: 12 },
  { code: '8-9',     label: 'Grade 8 – Grade 9', maxAge: 14 },
  { code: '10-11',   label: 'Grade 10 – Grade 11', maxAge: 999 },
]

export function computeAgeBand(dateOfBirth) {
  const age = Math.floor((new Date() - new Date(dateOfBirth)) / (365.25 * 24 * 3600 * 1000))
  const band = GRADE_BANDS.find(b => age <= b.maxAge)
  return band || GRADE_BANDS[GRADE_BANDS.length - 1]
}

// ============================================================
// TOKEN HELPERS (unchanged)
// ============================================================

export async function generatePlacementToken(applicantId, parentEmail, createdBy) {
  const { data, error } = await supabase
    .from('placement_tokens')
    .insert({ applicant_id: applicantId, sent_to_email: parentEmail, created_by: createdBy })
    .select('token').single()
  if (error) throw error
  return data.token
}

export async function validateToken(token) {
  const { data, error } = await supabase
    .from('placement_tokens')
    .select(`*, applicants ( id, full_name, date_of_birth, age_band )`)
    .eq('token', token).eq('is_used', false)
    .gt('expires_at', new Date().toISOString())
    .single()
  if (error || !data) return null
  return data
}

export async function consumeToken(tokenId) {
  const { error } = await supabase.from('placement_tokens')
    .update({ is_used: true, used_at: new Date().toISOString() }).eq('id', tokenId)
  if (error) throw error
}

// ============================================================
// APPLICANT HELPERS (unchanged)
// ============================================================

export async function createApplicant(data) {
  const { data: record, error } = await supabase.from('applicants').insert(data).select().single()
  if (error) throw error
  return record
}

export async function getApplicants(statusFilter = null) {
  let query = supabase.from('applicants').select('*, placement_decisions(*)').order('created_at', { ascending: false })
  if (statusFilter) query = query.eq('placement_status', statusFilter)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getApplicant(id) {
  const { data, error } = await supabase
    .from('applicants')
    .select(`*, placement_decisions(*), test_sessions(*, assessments(title, title_fr, subject)), interview_records(*)`)
    .eq('id', id).single()
  if (error) throw error
  return data
}

// ============================================================
// ASSESSMENT HELPERS — v3 (now includes general_paper, bilingual fields)
// ============================================================

export async function getAssessments(gradeBand = null) {
  let query = supabase.from('assessments').select('*, questions(count)').eq('is_active', true).order('grade_band')
  if (gradeBand) query = query.eq('grade_band', gradeBand)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getAssessmentWithQuestions(assessmentId) {
  const { data, error } = await supabase
    .from('assessments').select('*, questions(*)').eq('id', assessmentId)
    .order('order_index', { referencedTable: 'questions' }).single()
  if (error) throw error
  return data
}

// ============================================================
// SCORING HELPERS (unchanged logic, supports short_answer too)
// ============================================================

export async function gradeSession(sessionId) {
  const { data: answers, error } = await supabase
    .from('student_answers')
    .select('*, questions(correct_answer, marks, question_type)')
    .eq('session_id', sessionId)
  if (error) throw error

  let totalMarks = 0, earnedMarks = 0, hasManualGrading = false

  for (const answer of answers) {
    const q = answer.questions
    if (!q) continue

    if (q.question_type === 'essay') {
      hasManualGrading = true
      totalMarks += q.marks
      continue
    }

    totalMarks += q.marks

    if (q.question_type === 'mcq') {
      const studentAnswer = (answer.answer_text || '').trim().toUpperCase()
      const correctAnswer = (q.correct_answer || '').trim().toUpperCase()
      const isCorrect = studentAnswer === correctAnswer && studentAnswer !== ''
      if (isCorrect) earnedMarks += q.marks
      await supabase
        .from('student_answers')
        .update({ is_correct: isCorrect, marks_awarded: isCorrect ? q.marks : 0 })
        .eq('id', answer.id)
    } else if (q.question_type === 'short_answer') {
      hasManualGrading = true
    }
  }

  const percentage = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100 * 100) / 100 : 0

  await supabase
    .from('test_sessions')
    .update({
      raw_score: earnedMarks,
      percentage: percentage,
      status: hasManualGrading ? 'submitted' : 'graded'
    })
    .eq('id', sessionId)

  return { earnedMarks, totalMarks, percentage, hasManualGrading }
}
// ============================================================
// AUDIT LOG HELPER (unchanged)
// ============================================================

export async function logAudit({ tableName, recordId, action, oldValue, newValue, notes }) {
  const staff = await getCurrentStaff()
  await supabase.from('audit_log').insert({
    table_name: tableName, record_id: recordId, action,
    changed_by: staff?.id, old_value: oldValue, new_value: newValue, notes
  })
}

export async function computePlacement(applicantId) {
  const { error } = await supabase.rpc('compute_placement', { p_applicant_id: applicantId })
  if (error) throw error
}

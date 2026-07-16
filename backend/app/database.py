"""
Database module using SQLite for MVP.
Multi-tenant isolation via tenant_id on all records.
"""
import sqlite3
import os
from contextlib import contextmanager

# Check DATABASE_PATH first, then DATABASE_URL (strip sqlite:/// prefix), then default
_raw = os.environ.get("DATABASE_PATH") or os.environ.get("DATABASE_URL", "")
if _raw.startswith("sqlite:////"):
    # sqlite:////absolute/path -> /absolute/path
    _raw = _raw[len("sqlite:///"):]
elif _raw.startswith("sqlite:///"):
    # sqlite:///relative/path -> make absolute
    _raw = "/" + _raw[len("sqlite:///"):]
DATABASE_PATH = _raw or "/var/www/litigationspace/data/app.db"

# Ensure directory exists
_db_dir = os.path.dirname(DATABASE_PATH)
if _db_dir and not os.path.exists(_db_dir):
    try:
        os.makedirs(_db_dir, exist_ok=True)
    except OSError:
        # Fallback to local path for development
        DATABASE_PATH = os.path.join(os.path.dirname(__file__), "..", "app.db")


def get_db_path():
    return DATABASE_PATH


def get_connection():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize database tables."""
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('law_firm', 'solo_practitioner', 'corporate')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'attorney', 'paralegal', 'expert', 'expert_pending', 'expert_active', 'client')),
                bar_number TEXT,
                jurisdiction TEXT,
                specializations TEXT,
                hourly_rate REAL,
                status TEXT DEFAULT 'LOCKED' CHECK(status IN ('READY', 'BUSY', 'LOCKED')),
                last_heartbeat TIMESTAMP,
                avatar_url TEXT,
                bio TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            );

            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                title TEXT NOT NULL,
                case_number TEXT,
                case_type TEXT NOT NULL,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'pending', 'closed', 'archived')),
                priority TEXT DEFAULT 'medium' CHECK(priority IN ('critical', 'high', 'medium', 'low')),
                description TEXT,
                client_name TEXT,
                opposing_party TEXT,
                court TEXT,
                judge TEXT,
                filing_deadline TIMESTAMP,
                trial_date TIMESTAMP,
                uscis_receipt_number TEXT,
                uscis_status TEXT,
                uscis_last_checked TIMESTAMP,
                jurisdiction TEXT,
                forum TEXT,
                matter_type TEXT,
                party_roles TEXT,
                urgency_score REAL DEFAULT 0,
                completion_percentage REAL DEFAULT 0,
                exhibit_numbering TEXT DEFAULT 'letters',
                assigned_attorney_id TEXT,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                FOREIGN KEY (assigned_attorney_id) REFERENCES users(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS case_experts (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                expert_id TEXT NOT NULL,
                role TEXT DEFAULT 'consultant',
                access_level TEXT DEFAULT 'read' CHECK(access_level IN ('read', 'write', 'admin')),
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'revoked', 'expired')),
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (expert_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked')),
                assigned_to TEXT,
                due_date TIMESTAMP,
                priority TEXT DEFAULT 'medium',
                parent_task_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                FOREIGN KEY (assigned_to) REFERENCES users(id),
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER,
                mime_type TEXT,
                category TEXT DEFAULT 'general',
                bates_prefix TEXT,
                bates_start INTEGER,
                bates_end INTEGER,
                uploaded_by TEXT,
                share_token TEXT,
                share_expires_at TIMESTAMP,
                is_shared INTEGER DEFAULT 0,
                version INTEGER DEFAULT 1,
                content_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                FOREIGN KEY (uploaded_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS waitlist (
                id TEXT PRIMARY KEY,
                expert_id TEXT NOT NULL,
                requester_id TEXT NOT NULL,
                case_id TEXT,
                position INTEGER NOT NULL,
                status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting', 'notified', 'expired', 'fulfilled')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (expert_id) REFERENCES users(id),
                FOREIGN KEY (requester_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS time_entries (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP,
                duration_minutes REAL,
                description TEXT,
                billable INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS case_timeline (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                event_date TIMESTAMP NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                event_type TEXT DEFAULT 'general',
                evidence_ids TEXT,
                created_by TEXT,
                position_x REAL DEFAULT 0,
                position_y REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id)
            );

            CREATE TABLE IF NOT EXISTS contradictions (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                source_a_type TEXT NOT NULL,
                source_a_id TEXT NOT NULL,
                source_a_text TEXT,
                source_b_type TEXT NOT NULL,
                source_b_id TEXT NOT NULL,
                source_b_text TEXT,
                severity TEXT DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
                notes TEXT,
                resolved INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id)
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT,
                data TEXT,
                read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workflow_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                case_type TEXT NOT NULL,
                tasks_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS discovery_items (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                item_number TEXT NOT NULL,
                item_description TEXT NOT NULL,
                party TEXT DEFAULT 'plaintiff',
                date_served TIMESTAMP,
                date_due TIMESTAMP,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'received', 'overdue', 'objected', 'produced')),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id)
            );

            CREATE TABLE IF NOT EXISTS witnesses (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                witness_type TEXT DEFAULT 'fact' CHECK(witness_type IN ('fact', 'expert', 'character')),
                contact_info TEXT,
                phone TEXT,
                email TEXT,
                deposition_date TIMESTAMP,
                deposition_summary TEXT,
                key_admissions TEXT,
                cross_exam_questions TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id)
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS legal_drafts (
                id TEXT PRIMARY KEY,
                case_id TEXT,
                tenant_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                format_preset TEXT DEFAULT 'standard',
                document_type TEXT DEFAULT 'motion',
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft','internal_review','pending_fixes','client_review','approved','finalized','served_filed')),
                jurisdiction_id TEXT,
                court_name TEXT,
                word_count INTEGER DEFAULT 0,
                page_count INTEGER DEFAULT 0,
                page_limit INTEGER,
                word_limit_value INTEGER,
                version INTEGER DEFAULT 1,
                assigned_reviewer TEXT,
                client_review_token TEXT,
                client_review_expires TEXT,
                signed_at TEXT,
                finalized_at TEXT,
                filed_at TEXT,
                served_at TEXT,
                bates_prefix TEXT,
                bates_start INTEGER,
                proof_of_service TEXT,
                override_log TEXT DEFAULT '[]',
                last_auto_save TIMESTAMP,
                created_by TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS court_rules (
                id TEXT PRIMARY KEY,
                jurisdiction_id TEXT NOT NULL,
                court_name TEXT NOT NULL,
                pleading_paper INTEGER DEFAULT 0,
                default_font TEXT DEFAULT 'Times New Roman',
                font_size INTEGER DEFAULT 12,
                line_spacing REAL DEFAULT 2.0,
                margin_top REAL DEFAULT 1.0,
                margin_bottom REAL DEFAULT 1.0,
                margin_left REAL DEFAULT 1.0,
                margin_right REAL DEFAULT 1.0,
                doc_type_limits TEXT DEFAULT '{}',
                word_limit INTEGER,
                caption_format TEXT,
                pleading_caption_template TEXT,
                requires_toc INTEGER DEFAULT 0,
                toc_threshold_pages INTEGER DEFAULT 25,
                requires_toa INTEGER DEFAULT 0,
                toa_threshold_pages INTEGER DEFAULT 25,
                requires_certificate_of_service INTEGER DEFAULT 1,
                additional_rules TEXT DEFAULT '{}',
                is_verified INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS draft_versions (
                id TEXT PRIMARY KEY,
                draft_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                content TEXT NOT NULL,
                word_count INTEGER DEFAULT 0,
                change_summary TEXT,
                created_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (draft_id) REFERENCES legal_drafts(id)
            );

            CREATE TABLE IF NOT EXISTS research_citations (
                id TEXT PRIMARY KEY,
                draft_id TEXT NOT NULL,
                case_name TEXT NOT NULL,
                citation TEXT NOT NULL,
                court TEXT,
                year INTEGER,
                good_law_status TEXT DEFAULT 'unknown' CHECK(good_law_status IN ('good_law','caution','overruled','unknown')),
                courtlistener_url TEXT,
                courtlistener_id TEXT,
                snippet TEXT,
                applicability_score TEXT DEFAULT 'medium' CHECK(applicability_score IN ('high','medium','low')),
                inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (draft_id) REFERENCES legal_drafts(id)
            );

            CREATE TABLE IF NOT EXISTS draft_comments (
                id TEXT PRIMARY KEY,
                draft_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                content TEXT NOT NULL,
                selection_start INTEGER,
                selection_end INTEGER,
                selected_text TEXT,
                resolved INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (draft_id) REFERENCES legal_drafts(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                details TEXT DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Judicial Decision Engine tables (separate workspace)
            CREATE TABLE IF NOT EXISTS judicial_cases (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                case_title TEXT NOT NULL,
                case_number TEXT NOT NULL,
                case_type TEXT DEFAULT 'civil',
                court TEXT DEFAULT '',
                jurisdiction TEXT DEFAULT '',
                plaintiff TEXT DEFAULT '',
                defendant TEXT DEFAULT '',
                assigned_judge TEXT DEFAULT '',
                description TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS judicial_filings (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                filing_type TEXT NOT NULL,
                filing_party TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT DEFAULT '',
                filing_date TEXT,
                motion_association TEXT,
                exhibit_references TEXT,
                page_count INTEGER,
                uploaded_by TEXT DEFAULT '',
                status TEXT DEFAULT 'filed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES judicial_cases(id)
            );

            CREATE TABLE IF NOT EXISTS judicial_analysis (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                analysis_type TEXT DEFAULT 'full_case',
                content TEXT DEFAULT '{}',
                sources TEXT DEFAULT '[]',
                generated_at TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES judicial_cases(id)
            );

            CREATE TABLE IF NOT EXISTS judicial_hearings (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                hearing_type TEXT NOT NULL,
                scheduled_date TEXT NOT NULL,
                scheduled_time TEXT DEFAULT '',
                location TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                status TEXT DEFAULT 'scheduled',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES judicial_cases(id)
            );

            CREATE TABLE IF NOT EXISTS judicial_orders (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                order_type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT DEFAULT '',
                caption TEXT DEFAULT '',
                background TEXT DEFAULT '',
                legal_standard TEXT DEFAULT '',
                analysis TEXT DEFAULT '',
                conclusion TEXT DEFAULT '',
                status TEXT DEFAULT 'draft',
                created_by TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES judicial_cases(id)
            );

            CREATE TABLE IF NOT EXISTS judicial_audit_log (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                action TEXT NOT NULL,
                actor_id TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TEXT,
                FOREIGN KEY (case_id) REFERENCES judicial_cases(id)
            );

            -- Motion Analyzer tables (public marketing engine)
            CREATE TABLE IF NOT EXISTS motion_analyzer_sessions (
                session_id TEXT PRIMARY KEY,
                user_id TEXT,
                created_at TEXT,
                court TEXT DEFAULT '',
                motion_type TEXT DEFAULT 'summary_judgment',
                plaintiff_name TEXT DEFAULT '',
                defendant_name TEXT DEFAULT '',
                results_json TEXT DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS motion_analyzer_files (
                file_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                file_role TEXT DEFAULT 'motion',
                file_name TEXT DEFAULT '',
                file_content TEXT DEFAULT '',
                uploaded_at TEXT,
                FOREIGN KEY (session_id) REFERENCES motion_analyzer_sessions(session_id)
            );

            -- Motion Analyzer v2 tables
            CREATE TABLE IF NOT EXISTS motion_analysis_jobs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                status TEXT DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
                anon_token TEXT,
                user_id TEXT,
                case_id TEXT,
                motion_type TEXT DEFAULT 'summary_judgment',
                court TEXT DEFAULT '',
                jurisdiction TEXT DEFAULT '',
                input_doc_ids TEXT DEFAULT '[]',
                result_json TEXT DEFAULT '{}',
                share_slug TEXT UNIQUE,
                expires_at TEXT,
                win_probability INTEGER DEFAULT 0,
                confidence TEXT DEFAULT 'Low',
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS motion_documents (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                user_id TEXT,
                file_url TEXT DEFAULT '',
                doc_role TEXT DEFAULT 'motion' CHECK(doc_role IN ('motion','opposition','reply','other')),
                original_filename TEXT DEFAULT '',
                mime_type TEXT DEFAULT '',
                file_size INTEGER DEFAULT 0,
                parsed_text TEXT DEFAULT '',
                metadata_json TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (job_id) REFERENCES motion_analysis_jobs(id)
            );

            CREATE TABLE IF NOT EXISTS motion_analytics_events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                job_id TEXT,
                user_id TEXT,
                metadata_json TEXT DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            -- Growth OS: Prospect Law Firms
            CREATE TABLE IF NOT EXISTS prospects_lawfirms (
                id TEXT PRIMARY KEY,
                firm_name TEXT NOT NULL,
                attorney_name TEXT DEFAULT '',
                practice_area TEXT DEFAULT '',
                location TEXT DEFAULT '',
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                website TEXT DEFAULT '',
                linkedin TEXT DEFAULT '',
                lead_status TEXT DEFAULT 'new',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Prospect Experts (with role_type ENUM)
            CREATE TABLE IF NOT EXISTS prospects_experts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role_type TEXT DEFAULT 'EXPERT_WITNESS' CHECK(role_type IN (
                    'FREELANCE_PARALEGAL','COURT_REPORTER','PROCESS_SERVER',
                    'EXPERT_WITNESS','CLERK_SUPPORT','CASE_MANAGER',
                    'FREELANCE_LAWYER','MEDIATOR','ARBITRATOR','IMMIGRATION_CONSULTANT'
                )),
                practice_area TEXT DEFAULT '',
                jurisdiction TEXT DEFAULT '',
                email TEXT DEFAULT '',
                linkedin TEXT DEFAULT '',
                status TEXT DEFAULT 'new',
                invited INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Live Bench: Public profile cards (stock-photo profiles)
            CREATE TABLE IF NOT EXISTS live_bench_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                specialty TEXT NOT NULL,
                location TEXT NOT NULL,
                rate INTEGER DEFAULT 0,
                status TEXT DEFAULT 'READY' CHECK(status IN ('READY','BUSY')),
                rating REAL DEFAULT 4.8,
                cases INTEGER DEFAULT 0,
                experience INTEGER DEFAULT 0,
                photo_url TEXT DEFAULT '',
                bio TEXT DEFAULT '',
                jurisdictions_json TEXT DEFAULT '[]',
                featured INTEGER DEFAULT 0,
                source TEXT DEFAULT 'seed',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Email Sequences
            CREATE TABLE IF NOT EXISTS email_sequences (
                id TEXT PRIMARY KEY,
                sequence_name TEXT NOT NULL,
                step INTEGER DEFAULT 1,
                delay_days INTEGER DEFAULT 0,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Outreach Log
            CREATE TABLE IF NOT EXISTS outreach_log (
                id TEXT PRIMARY KEY,
                prospect_id TEXT NOT NULL,
                prospect_type TEXT DEFAULT 'lawfirm',
                sequence_name TEXT DEFAULT '',
                step INTEGER DEFAULT 1,
                subject TEXT DEFAULT '',
                body TEXT DEFAULT '',
                status TEXT DEFAULT 'sent',
                error_msg TEXT DEFAULT '',
                sent_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Social Media Posts
            CREATE TABLE IF NOT EXISTS social_posts (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                content TEXT NOT NULL,
                post_type TEXT DEFAULT 'text',
                status TEXT DEFAULT 'scheduled',
                scheduled_at TEXT,
                published_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                website_id TEXT DEFAULT 'ls'
            );

            -- Growth OS: Blog Articles
            CREATE TABLE IF NOT EXISTS blog_articles (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                meta_description TEXT DEFAULT '',
                target_keywords TEXT DEFAULT '',
                view_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                website_id TEXT DEFAULT 'ls'
            );

            -- Growth OS: Lead Capture from Motion Analyzer
            CREATE TABLE IF NOT EXISTS leads_motion_analyzer (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                firm_name TEXT DEFAULT '',
                practice_area TEXT DEFAULT '',
                jurisdiction TEXT DEFAULT '',
                source TEXT DEFAULT 'motion_analyzer',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                website_id TEXT DEFAULT 'ls'
            );

            -- Growth OS: Referrals
            CREATE TABLE IF NOT EXISTS referrals (
                id TEXT PRIMARY KEY,
                referrer_id TEXT NOT NULL,
                referral_code TEXT UNIQUE NOT NULL,
                total_referrals INTEGER DEFAULT 0,
                successful_referrals INTEGER DEFAULT 0,
                reward_months INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Analytics (Time Saved ROI + metrics)
            CREATE TABLE IF NOT EXISTS growth_analytics (
                id TEXT PRIMARY KEY,
                metric_name TEXT NOT NULL,
                metric_value REAL DEFAULT 0,
                metadata_json TEXT DEFAULT '{}',
                recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Cron Job Log
            CREATE TABLE IF NOT EXISTS cron_log (
                id TEXT PRIMARY KEY,
                job_name TEXT NOT NULL,
                status TEXT DEFAULT 'success',
                details TEXT DEFAULT '',
                executed_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Email Marketing: Campaigns
            CREATE TABLE IF NOT EXISTS email_campaigns (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                campaign_type TEXT DEFAULT 'outreach' CHECK(campaign_type IN ('outreach', 'newsletter', 'drip', 'onboarding')),
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
                sender_email TEXT DEFAULT 'noreply@litigationspace.com',
                sender_name TEXT DEFAULT 'LitigationSpace',
                reply_to TEXT DEFAULT 'support@litigationspace.com',
                sequence_name TEXT,
                target_audience TEXT DEFAULT 'all',
                daily_limit INTEGER DEFAULT 50,
                total_target INTEGER DEFAULT 0,
                total_sent INTEGER DEFAULT 0,
                total_delivered INTEGER DEFAULT 0,
                total_bounced INTEGER DEFAULT 0,
                total_opened INTEGER DEFAULT 0,
                total_clicked INTEGER DEFAULT 0,
                total_unsubscribed INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                started_at TEXT,
                completed_at TEXT,
                website_id TEXT DEFAULT 'ls'
            );

            -- Email Marketing: Queue (individual emails waiting to be sent)
            CREATE TABLE IF NOT EXISTS email_queue (
                id TEXT PRIMARY KEY,
                campaign_id TEXT,
                prospect_id TEXT,
                prospect_type TEXT DEFAULT 'lawfirm',
                to_email TEXT NOT NULL,
                to_name TEXT DEFAULT '',
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
                error_msg TEXT DEFAULT '',
                sequence_step INTEGER DEFAULT 1,
                scheduled_for TEXT,
                sent_at TEXT,
                delivered_at TEXT,
                opened_at TEXT,
                clicked_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id)
            );

            -- Email Marketing: Unsubscribes
            CREATE TABLE IF NOT EXISTS email_unsubscribes (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                reason TEXT DEFAULT '',
                source TEXT DEFAULT 'link',
                unsubscribed_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Email Marketing: Bounce tracking
            CREATE TABLE IF NOT EXISTS email_bounces (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                bounce_type TEXT DEFAULT 'hard' CHECK(bounce_type IN ('hard', 'soft')),
                error_msg TEXT DEFAULT '',
                queue_item_id TEXT,
                bounced_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Growth OS: Config table (for pause/resume switches)
            CREATE TABLE IF NOT EXISTS growth_config (
                id TEXT PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value TEXT DEFAULT '',
                website_id TEXT DEFAULT 'ls'
            );

            -- Document review comments & approvals
            CREATE TABLE IF NOT EXISTS doc_reviews (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                share_token TEXT,
                reviewer_name TEXT NOT NULL,
                page_number INTEGER,
                comment TEXT,
                action TEXT DEFAULT 'comment' CHECK(action IN ('comment', 'approve', 'reject', 'request_changes')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );

            -- Signature requests (separate from document reviews)
            CREATE TABLE IF NOT EXISTS signature_requests (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                signer_name TEXT NOT NULL,
                signer_email TEXT NOT NULL,
                sign_token TEXT UNIQUE NOT NULL,
                signature_pages TEXT NOT NULL DEFAULT '[]',
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'signed', 'declined', 'expired')),
                message TEXT DEFAULT '',
                signed_at TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );

            -- Individual page signatures within a signature request
            CREATE TABLE IF NOT EXISTS page_signatures (
                id TEXT PRIMARY KEY,
                signature_request_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                signature_data TEXT NOT NULL,
                signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id)
            );

            -- Case contacts (debtors / opposing parties / clients to contact)
            CREATE TABLE IF NOT EXISTS case_contacts (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT,
                company TEXT,
                amount_owed REAL,
                currency TEXT DEFAULT 'USD',
                notes TEXT,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'unresponsive', 'responsive', 'resolved', 'escalated')),
                last_contacted_at TIMESTAMP,
                total_emails_sent INTEGER DEFAULT 0,
                total_emails_opened INTEGER DEFAULT 0,
                total_replies INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            );

            -- Outreach emails sent from the platform
            CREATE TABLE IF NOT EXISTS case_emails (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                sender_user_id TEXT NOT NULL,
                template_type TEXT DEFAULT 'custom',
                subject TEXT NOT NULL,
                body_html TEXT NOT NULL,
                body_text TEXT,
                from_name TEXT,
                from_email TEXT,
                status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'delivered', 'opened', 'replied', 'bounced', 'failed')),
                sent_at TIMESTAMP,
                delivered_at TIMESTAMP,
                opened_at TIMESTAMP,
                replied_at TIMESTAMP,
                open_count INTEGER DEFAULT 0,
                tracking_id TEXT UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (contact_id) REFERENCES case_contacts(id),
                FOREIGN KEY (sender_user_id) REFERENCES users(id)
            );

            -- Email tracking events (delivery, open, click, reply, bounce)
            CREATE TABLE IF NOT EXISTS email_tracking_events (
                id TEXT PRIMARY KEY,
                email_id TEXT NOT NULL,
                event_type TEXT NOT NULL CHECK(event_type IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed')),
                event_data TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (email_id) REFERENCES case_emails(id)
            );

            -- Pipeline stage on cases (extends the status field for outreach workflows)
            CREATE TABLE IF NOT EXISTS case_pipeline (
                id TEXT PRIMARY KEY,
                case_id TEXT UNIQUE NOT NULL,
                tenant_id TEXT NOT NULL,
                stage TEXT DEFAULT 'onboarding' CHECK(stage IN ('onboarding', 'active_outreach', 'responsive', 'unresponsive', 'litigation', 'resolved')),
                stage_changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                auto_escalation_enabled INTEGER DEFAULT 1,
                escalation_after_days INTEGER DEFAULT 30,
                max_attempts INTEGER DEFAULT 3,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (case_id) REFERENCES cases(id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            );
        """)

        # Create billing tables (contracts, contract_tasks, invoices, invoice_items,
        # billing_time_entries) — previously only existed on the live DB, never committed
        _create_billing_tables(db)

        # Outreach Phase 1 — thread events, document-link tracking, participants, notes
        _create_outreach_thread_tables(db)
        _migrate_outreach_document_links_wet_sign_mode(db)
        _migrate_signature_requests_outreach_columns(db)
        _migrate_email_template_custom_plaintext_columns(db)

        # Staged 5-step escalation campaigns — never had a CREATE TABLE anywhere
        _fix_orphaned_campaign_emails_table(db)
        _create_outreach_campaign_tables(db)

        # Per-case external collaborators (Case Team & Access invite panel)
        _create_case_collaborators_table(db)

        # Case notes table (Case Vault "Notes" tab)
        _create_case_notes_table(db)
        _migrate_case_campaigns_type_column(db)
        _migrate_case_campaigns_approval_columns(db)

        # Add task approval-gate + entity-attribution columns to billing tables
        _migrate_billing_approval_columns(db)
        _migrate_billing_contingency_type(db)

        # Migrate existing legal_drafts table if needed (add new columns)
        _migrate_legal_drafts(db)

        # Migrate users table to support expert_pending/expert_active roles
        _migrate_users_roles(db)

        # Migrate users table for email verification + password reset
        _migrate_users_auth(db)

        # Migrate documents table to add is_merged flag
        _migrate_documents_is_merged(db)

        # Migrate documents table to add exhibit columns
        _migrate_documents_exhibit_columns(db)

        # Migrate documents table to add formatted HTML for review
        _migrate_documents_content_html(db)

        # Migrate blog_articles table to add status column (used by Growth OS cron/admin)
        _migrate_blog_articles_status(db)

        # Migrate cases table to add jurisdiction/forum/matter_type/party_roles
        _migrate_cases_jurisdiction_fields(db)

        # Migrate users table — subscription, trial, credits system
        _migrate_users_subscription(db)

        # Seed Live Bench public profiles (stock photo cards)
        _seed_live_bench_profiles(db)

        # Seed workflow templates for all 5 case categories
        _seed_workflow_templates(db)

        # Seed court rules
        _seed_court_rules(db)


def _seed_live_bench_profiles(db):
    """Seed initial Live Bench profiles for public marketing pages."""
    import uuid
    import json

    try:
        existing = db.execute("SELECT COUNT(*) as cnt FROM live_bench_profiles").fetchone()["cnt"]
        if existing >= 18:
            return

        if existing == 0:
            profiles = [
                {
                    "name": "Sarah Chen",
                    "role": "Immigration Attorney",
                    "specialty": "Immigration Law",
                    "location": "New York, NY",
                    "rate": 350,
                    "status": "READY",
                    "rating": 4.9,
                    "cases": 120,
                    "experience": 12,
                    "photo_url": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&h=200&fit=crop&crop=face",
                    "bio": "Former DOJ immigration counsel. Specializes in complex removal defense and federal litigation.",
                    "jurisdictions": ["New York", "New Jersey", "Federal"],
                    "featured": 1,
                },
                {
                    "name": "Michael Torres",
                    "role": "Civil Litigation Partner",
                    "specialty": "Civil Litigation",
                    "location": "Los Angeles, CA",
                    "rate": 425,
                    "status": "READY",
                    "rating": 4.8,
                    "cases": 95,
                    "experience": 14,
                    "photo_url": "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop&crop=face",
                    "bio": "Lead trial counsel in high-stakes commercial disputes. Known for fast TRO/PI execution.",
                    "jurisdictions": ["California", "Federal"],
                    "featured": 1,
                },
                {
                    "name": "Dr. Emily Washington",
                    "role": "Expert Witness (Medical)",
                    "specialty": "Medical Malpractice",
                    "location": "Chicago, IL",
                    "rate": 550,
                    "status": "READY",
                    "rating": 5.0,
                    "cases": 67,
                    "experience": 18,
                    "photo_url": "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&h=200&fit=crop&crop=face",
                    "bio": "Board-certified surgeon with extensive deposition and trial testimony in malpractice matters.",
                    "jurisdictions": ["Illinois", "Indiana"],
                    "featured": 1,
                },
                {
                    "name": "David Park",
                    "role": "Senior Paralegal",
                    "specialty": "Litigation Support",
                    "location": "San Francisco, CA",
                    "rate": 150,
                    "status": "READY",
                    "rating": 4.7,
                    "cases": 200,
                    "experience": 10,
                    "photo_url": "https://images.unsplash.com/photo-1615109398623-88346a601842?w=200&h=200&fit=crop&crop=face",
                    "bio": "E-discovery + trial prep specialist. Manages exhibits, witness binders, and deadlines under pressure.",
                    "jurisdictions": ["California"],
                    "featured": 1,
                },
                {
                    "name": "Hon. Lisa Rodriguez",
                    "role": "Retired Federal Judge",
                    "specialty": "Arbitration & Mediation",
                    "location": "Miami, FL",
                    "rate": 650,
                    "status": "BUSY",
                    "rating": 5.0,
                    "cases": 30,
                    "experience": 25,
                    "photo_url": "https://images.unsplash.com/photo-1607746882042-944635dfe10e?w=200&h=200&fit=crop&crop=face",
                    "bio": "Former federal judge now serving as neutral in complex commercial matters and emergency hearings.",
                    "jurisdictions": ["Florida", "Federal"],
                    "featured": 1,
                },
            ]

            # Add 13 additional strong profiles (non-featured) quickly (still photo-backed)
            profiles += [
                {
                    "name": "James Okafor",
                    "role": "Arbitrator & Mediator",
                    "specialty": "Arbitration",
                    "location": "Houston, TX",
                    "rate": 475,
                    "status": "READY",
                    "rating": 4.9,
                    "cases": 55,
                    "experience": 16,
                    "photo_url": "https://images.unsplash.com/photo-1590086782957-93c06ef21604?w=200&h=200&fit=crop&crop=face",
                    "bio": "AAA-trained neutral for commercial and employment disputes. Focused on fast, enforceable outcomes.",
                    "jurisdictions": ["Texas"],
                    "featured": 0,
                },
                {
                    "name": "Rachel Kim",
                    "role": "Criminal Defense Attorney",
                    "specialty": "Criminal Litigation",
                    "location": "Washington, DC",
                    "rate": 400,
                    "status": "READY",
                    "rating": 4.9,
                    "cases": 88,
                    "experience": 11,
                    "photo_url": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face",
                    "bio": "Former AUSA. Strong motion practice and evidentiary hearings with tight deadlines.",
                    "jurisdictions": ["District of Columbia", "Maryland", "Federal"],
                    "featured": 0,
                },
                {
                    "name": "Marcus Williams",
                    "role": "Employment Law Counsel",
                    "specialty": "Employment Law",
                    "location": "Atlanta, GA",
                    "rate": 375,
                    "status": "READY",
                    "rating": 4.8,
                    "cases": 110,
                    "experience": 13,
                    "photo_url": "https://images.unsplash.com/photo-1528892952291-009c663ce843?w=200&h=200&fit=crop&crop=face",
                    "bio": "Defends and prosecutes wage/hour and discrimination claims. Sharp discovery strategy and MSJ writing.",
                    "jurisdictions": ["Georgia", "Federal"],
                    "featured": 0,
                },
                {
                    "name": "Priya Nair",
                    "role": "Forensic Accountant",
                    "specialty": "Forensic Accounting",
                    "location": "Dallas, TX",
                    "rate": 300,
                    "status": "READY",
                    "rating": 4.9,
                    "cases": 76,
                    "experience": 15,
                    "photo_url": "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?w=200&h=200&fit=crop&crop=face",
                    "bio": "Quantifies damages and traces funds for fraud, contract, and business divorce litigation.",
                    "jurisdictions": ["Texas", "Federal"],
                    "featured": 0,
                },
                {
                    "name": "Anthony Delgado",
                    "role": "IP Litigation Counsel",
                    "specialty": "Intellectual Property",
                    "location": "Boston, MA",
                    "rate": 500,
                    "status": "BUSY",
                    "rating": 4.8,
                    "cases": 42,
                    "experience": 12,
                    "photo_url": "https://images.unsplash.com/photo-1556157382-97eda2d62296?w=200&h=200&fit=crop&crop=face",
                    "bio": "Patent/trade secret disputes with deep technical record building and expert coordination.",
                    "jurisdictions": ["Massachusetts", "Federal"],
                    "featured": 0,
                },
                {
                    "name": "Alicia Moore",
                    "role": "Court Reporter",
                    "specialty": "Court Reporting",
                    "location": "Phoenix, AZ",
                    "rate": 120,
                    "status": "READY",
                    "rating": 4.8,
                    "cases": 300,
                    "experience": 9,
                    "photo_url": "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=200&h=200&fit=crop&crop=face",
                    "bio": "Realtime deposition reporting with fast turnarounds and secure transcript handling.",
                    "jurisdictions": ["Arizona"],
                    "featured": 0,
                },
                {
                    "name": "Noah Bennett",
                    "role": "Process Server",
                    "specialty": "Process Service",
                    "location": "Las Vegas, NV",
                    "rate": 95,
                    "status": "READY",
                    "rating": 4.7,
                    "cases": 500,
                    "experience": 8,
                    "photo_url": "https://images.unsplash.com/photo-1552058544-f2b08422138a?w=200&h=200&fit=crop&crop=face",
                    "bio": "High-success service in hard-to-serve situations. Detailed affidavits and rapid updates.",
                    "jurisdictions": ["Nevada"],
                    "featured": 0,
                },
                {
                    "name": "Sophia Patel",
                    "role": "Family Law Attorney",
                    "specialty": "Family Law",
                    "location": "Seattle, WA",
                    "rate": 325,
                    "status": "READY",
                    "rating": 4.8,
                    "cases": 90,
                    "experience": 10,
                    "photo_url": "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?w=200&h=200&fit=crop&crop=face",
                    "bio": "Custody and high-conflict dissolution matters with strong evidentiary motion practice.",
                    "jurisdictions": ["Washington"],
                    "featured": 0,
                },
                {
                    "name": "Ethan Brooks",
                    "role": "Real Estate Litigation Attorney",
                    "specialty": "Real Estate",
                    "location": "Denver, CO",
                    "rate": 360,
                    "status": "READY",
                    "rating": 4.7,
                    "cases": 60,
                    "experience": 9,
                    "photo_url": "https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?w=200&h=200&fit=crop&crop=face",
                    "bio": "Handles title disputes, construction defects, and emergency injunctions for property matters.",
                    "jurisdictions": ["Colorado"],
                    "featured": 0,
                },
                {
                    "name": "Olivia Sanchez",
                    "role": "Bankruptcy Attorney",
                    "specialty": "Bankruptcy",
                    "location": "Orlando, FL",
                    "rate": 340,
                    "status": "READY",
                    "rating": 4.8,
                    "cases": 80,
                    "experience": 11,
                    "photo_url": "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&h=200&fit=crop&crop=face",
                    "bio": "Chapter 11/7 strategy with litigation support for adversary proceedings.",
                    "jurisdictions": ["Florida", "Federal"],
                    "featured": 0,
                },
                {
                    "name": "Daniel Reed",
                    "role": "Environmental Counsel",
                    "specialty": "Environmental Law",
                    "location": "Portland, OR",
                    "rate": 410,
                    "status": "BUSY",
                    "rating": 4.7,
                    "cases": 35,
                    "experience": 14,
                    "photo_url": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop&crop=face",
                    "bio": "Regulatory enforcement and complex expert-heavy record development.",
                    "jurisdictions": ["Oregon", "Washington"],
                    "featured": 0,
                },
                {
                    "name": "Hannah Thompson",
                    "role": "Tax Controversy Attorney",
                    "specialty": "Tax Law",
                    "location": "Austin, TX",
                    "rate": 450,
                    "status": "READY",
                    "rating": 4.8,
                    "cases": 40,
                    "experience": 12,
                    "photo_url": "https://images.unsplash.com/photo-1524503033411-f1df0fdb4fdc?w=200&h=200&fit=crop&crop=face",
                    "bio": "IRS disputes, audits, and tax litigation support with clean documentation workflows.",
                    "jurisdictions": ["Texas", "Federal"],
                    "featured": 0,
                },
                {
                    "name": "Victor Huang",
                    "role": "Corporate Counsel",
                    "specialty": "Corporate Law",
                    "location": "Newark, NJ",
                    "rate": 390,
                    "status": "READY",
                    "rating": 4.7,
                    "cases": 65,
                    "experience": 10,
                    "photo_url": "https://images.unsplash.com/photo-1545996124-0501ebae84d0?w=200&h=200&fit=crop&crop=face",
                    "bio": "M&A disputes and shareholder litigation with strong deal-document forensics.",
                    "jurisdictions": ["New Jersey", "New York"],
                    "featured": 0,
                },
                {
                    "name": "Grace Miller",
                    "role": "Mediation Specialist",
                    "specialty": "Mediation",
                    "location": "Nashville, TN",
                    "rate": 425,
                    "status": "READY",
                    "rating": 4.9,
                    "cases": 120,
                    "experience": 17,
                    "photo_url": "https://images.unsplash.com/photo-1520975958225-0d4e61d1c53d?w=200&h=200&fit=crop&crop=face",
                    "bio": "Facilitates settlement in employment and commercial matters; focuses on swift, durable agreements.",
                    "jurisdictions": ["Tennessee"],
                    "featured": 0,
                },
            ]

            for p in profiles:
                db.execute(
                    """INSERT INTO live_bench_profiles (id, name, role, specialty, location, rate, status, rating, cases, experience, photo_url, bio, jurisdictions_json, featured, source, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', CURRENT_TIMESTAMP)""",
                    (
                        uuid.uuid4().hex,
                        p["name"],
                        p["role"],
                        p["specialty"],
                        p["location"],
                        p["rate"],
                        p["status"],
                        p["rating"],
                        p["cases"],
                        p["experience"],
                        p["photo_url"],
                        p["bio"],
                        json.dumps(p["jurisdictions"]),
                        p["featured"],
                    ),
                )
    except Exception:
        # Seeding should never block startup
        pass


def _seed_workflow_templates(db):
    """Seed comprehensive workflow templates for each case category."""
    import json
    import uuid

    existing = db.execute("SELECT COUNT(*) as cnt FROM workflow_templates").fetchone()["cnt"]
    if existing >= 5:
        return  # Already seeded

    # Clear old templates and re-seed
    db.execute("DELETE FROM workflow_templates")

    templates = {
        "immigration_law": {
            "name": "Immigration Law",
            "tasks": [
                "Initial client consultation and intake",
                "Determine visa category eligibility assessment",
                "Conduct conflict of interest check",
                "Prepare Form G-28 (Notice of Entry of Appearance)",
                "Collect supporting documentation (passport, photos, birth certificate)",
                "Obtain employer support letter",
                "Prepare Labor Condition Application (LCA) / Form ETA-9035",
                "File prevailing wage determination request",
                "Obtain credential evaluation for foreign degrees",
                "Prepare Form I-129 (Petition for Nonimmigrant Worker)",
                "Prepare Form I-140 (Immigrant Petition for Alien Workers)",
                "Prepare Form I-485 (Adjustment of Status)",
                "Prepare Form I-765 (Employment Authorization Document / EAD)",
                "Prepare Form I-131 (Advance Parole / Travel Document)",
                "Prepare Form I-864 (Affidavit of Support)",
                "Collect evidence of extraordinary ability (O-1 cases)",
                "Prepare legal brief / cover letter for petition",
                "Compile country conditions documentation",
                "File petition with USCIS",
                "Monitor USCIS case status and receipt notices",
                "Respond to Request for Evidence (RFE)",
                "Prepare for USCIS interview (if required)",
                "Prepare consular processing documents (DS-160)",
                "Coordinate with National Visa Center (NVC)",
                "File Form I-290B (Appeal/Motion) if denied",
                "Prepare Form I-539 (Extension/Change of Status)",
                "Review and submit final evidence package",
                "Notify client of approval/denial and next steps",
                "Post-approval compliance and monitoring",
                "Close case file and final accounting",
            ],
        },
        "civil_litigation": {
            "name": "Civil Litigation",
            "tasks": [
                "Initial client consultation and case evaluation",
                "Conduct conflict of interest check",
                "Prepare engagement letter and fee agreement",
                "Investigate facts and gather preliminary evidence",
                "Draft and file Complaint / Petition",
                "Prepare Civil Cover Sheet (Form JS-44 for federal)",
                "Prepare Summons for service of process",
                "Arrange service of process on defendant(s)",
                "File proof of service / affidavit of service",
                "Review and respond to Answer / Counterclaim",
                "File Motion to Dismiss (Rule 12(b)) if applicable",
                "Attend Rule 26(f) scheduling conference",
                "Draft proposed scheduling order / case management plan",
                "Prepare and serve Initial Disclosures (Rule 26(a))",
                "Draft and serve Interrogatories (Rule 33)",
                "Draft and serve Requests for Production of Documents (Rule 34)",
                "Draft and serve Requests for Admissions (Rule 36)",
                "Review and respond to opposing party discovery requests",
                "Prepare privilege log for withheld documents",
                "File Motion to Compel Discovery (Rule 37) if needed",
                "Schedule and prepare for depositions (Rule 30)",
                "Retain and prepare expert witnesses",
                "File expert witness disclosures (Rule 26(a)(2))",
                "Attend mediation / settlement conference",
                "File Motion for Summary Judgment (Rule 56)",
                "File Motions in Limine (pretrial evidentiary motions)",
                "Prepare pretrial statement / trial brief",
                "Prepare witness list and exhibit list",
                "Prepare jury instructions (if jury trial)",
                "Prepare opening statement",
                "Prepare direct and cross-examination outlines",
                "Prepare closing argument",
                "Attend trial proceedings",
                "File post-trial motions (new trial, JNOV)",
                "Prepare and file Notice of Appeal (if applicable)",
                "Final case review, billing reconciliation, and file closure",
            ],
        },
        "criminal_litigation": {
            "name": "Criminal Litigation",
            "tasks": [
                "Initial client consultation and case review",
                "Review police reports, arrest records, and charging documents",
                "File Entry of Appearance / Notice of Representation",
                "Attend arraignment / initial hearing",
                "File motion for bail / bond reduction hearing",
                "Request and review discovery from prosecution",
                "File Brady / Giglio request for exculpatory evidence",
                "Conduct independent investigation of facts",
                "Interview defense witnesses and alibi witnesses",
                "Retain expert witnesses (forensic, medical, toxicology)",
                "File Motion to Suppress Evidence (4th Amendment)",
                "File Motion to Suppress Statements (5th Amendment)",
                "File Motion to Dismiss Charges / Indictment",
                "Attend preliminary hearing / grand jury proceedings",
                "Prepare subpoenas for witnesses and documents",
                "Review surveillance footage, phone records, digital evidence",
                "Negotiate plea agreement with prosecution (if applicable)",
                "File pretrial motions (change of venue, continuance, severance)",
                "Prepare trial strategy and theory of defense",
                "Prepare jury selection questionnaire (voir dire)",
                "Prepare opening statement",
                "Prepare direct examination of defense witnesses",
                "Prepare cross-examination of prosecution witnesses",
                "Prepare and organize exhibit list",
                "Draft proposed jury instructions",
                "Prepare closing argument",
                "Attend all trial proceedings",
                "File post-trial motions (motion for new trial, acquittal)",
                "Prepare sentencing memorandum and mitigation package",
                "Attend sentencing hearing",
                "File Notice of Appeal (if applicable)",
                "Prepare appellate brief",
                "Coordinate with probation/parole officer (if applicable)",
                "Final case review and client notification",
            ],
        },
        "arbitration": {
            "name": "Arbitration",
            "tasks": [
                "Initial client consultation and dispute assessment",
                "Review arbitration clause / agreement in contract",
                "Evaluate enforceability of arbitration agreement",
                "Select arbitration forum (AAA, JAMS, ICC, FINRA, etc.)",
                "Prepare and file Demand for Arbitration / Statement of Claim",
                "Pay arbitration filing fees and deposits",
                "Review Respondent's Answer / Counterclaim",
                "Participate in arbitrator selection process",
                "Review arbitrator disclosures for conflicts of interest",
                "Attend preliminary hearing / scheduling conference",
                "Draft and exchange initial disclosures",
                "Prepare and serve document requests",
                "Prepare and serve interrogatories (if forum rules permit)",
                "Schedule and conduct depositions (if forum rules permit)",
                "File motions for interim or emergency relief (if needed)",
                "Retain and prepare expert witnesses",
                "Prepare witness statements / declarations",
                "Prepare and submit pre-hearing briefs",
                "Prepare exhibit list and organize all exhibits",
                "Prepare opening statement",
                "Prepare direct examination outlines for witnesses",
                "Prepare cross-examination outlines for opposing witnesses",
                "Attend arbitration hearing sessions",
                "Prepare closing argument or post-hearing brief",
                "File post-hearing submissions (if requested by arbitrator)",
                "Review and analyze arbitration award",
                "File petition to confirm arbitration award in court",
                "File motion to vacate arbitration award (if applicable)",
                "Enforce arbitration award and collect judgment",
                "Final case review, billing reconciliation, and file closure",
            ],
        },
        "mediation": {
            "name": "Mediation",
            "tasks": [
                "Initial client consultation and conflict assessment",
                "Review mediation clause / agreement (if applicable)",
                "Evaluate suitability of dispute for mediation",
                "Select mediation forum or private mediator",
                "File Request for Mediation / initiate process",
                "Pay mediation fees and administrative costs",
                "Exchange pre-mediation statements with opposing party",
                "Prepare confidential mediation position statement / brief",
                "Gather and organize all supporting documents and evidence",
                "Calculate damages and prepare settlement range analysis",
                "Identify key interests, priorities, and BATNA",
                "Prepare client for mediation session and expectations",
                "Prepare opening statement for joint session",
                "Attend mediation session (joint and caucus)",
                "Negotiate terms during caucus sessions",
                "Evaluate and counter settlement proposals",
                "Draft Memorandum of Understanding (MOU) if agreement reached",
                "Draft formal Settlement Agreement",
                "Review and finalize settlement terms with client",
                "Obtain client signature on settlement agreement",
                "File stipulation of dismissal (if litigation is pending)",
                "Coordinate payment / performance of settlement terms",
                "Monitor compliance with settlement agreement",
                "File motion to enforce settlement (if breach occurs)",
                "Close case file and final accounting",
            ],
        },
    }

    for case_type, data in templates.items():
        template_id = str(uuid.uuid4())[:8]
        db.execute(
            "INSERT INTO workflow_templates (id, name, case_type, tasks_json) VALUES (?, ?, ?, ?)",
            (template_id, data["name"], case_type, json.dumps(data["tasks"]))
        )


def _migrate_users_roles(db):
    """Migrate users table to support expert_pending and expert_active roles.
    SQLite doesn't support ALTER CHECK, so we recreate the table if needed."""
    try:
        test = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").fetchone()
        # Skip if table already has the expanded role set (mediator, barrister, etc.)
        if test and 'expert_pending' not in test['sql'] and 'mediator' not in test['sql']:
            # Disable foreign keys temporarily for migration
            db.execute("PRAGMA foreign_keys=OFF")
            db.execute("""
                CREATE TABLE IF NOT EXISTS users_new (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('admin', 'attorney', 'paralegal', 'expert', 'expert_pending', 'expert_active', 'client')),
                    bar_number TEXT,
                    jurisdiction TEXT,
                    specializations TEXT,
                    hourly_rate REAL,
                    status TEXT DEFAULT 'LOCKED' CHECK(status IN ('READY', 'BUSY', 'LOCKED')),
                    last_heartbeat TIMESTAMP,
                    avatar_url TEXT,
                    bio TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
                )
            """)
            db.execute("INSERT OR IGNORE INTO users_new SELECT * FROM users")
            db.execute("DROP TABLE users")
            db.execute("ALTER TABLE users_new RENAME TO users")
            db.execute("PRAGMA foreign_keys=ON")
            print("[MIGRATION] Users table migrated to support expert_pending/expert_active roles")
    except Exception as e:
        print(f"[MIGRATION WARNING] Users roles migration: {e}")
        # Re-enable foreign keys even on failure
        try:
            db.execute("PRAGMA foreign_keys=ON")
        except Exception:
            pass


def _migrate_users_auth(db):
    """Add email verification and password reset columns to users table."""
    try:
        columns_info = db.execute("PRAGMA table_info(users)").fetchall()
        existing_cols = {col["name"] for col in columns_info}

        auth_migrations = [
            ("email_verified", "INTEGER DEFAULT 0"),
            ("email_verification_token", "TEXT"),
            ("email_verification_expires_at", "TIMESTAMP"),
            ("verified_at", "TIMESTAMP"),
            ("password_reset_token", "TEXT"),
            ("password_reset_expires_at", "TIMESTAMP"),
        ]

        for col_name, col_type in auth_migrations:
            if col_name not in existing_cols:
                db.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
                print(f"[MIGRATION] Added {col_name} to users table")

        # Mark all existing users as verified (they registered before verification was required)
        if "email_verified" not in existing_cols:
            db.execute("UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0")
            print("[MIGRATION] Marked existing users as email_verified=1")
    except Exception as e:
        print(f"[MIGRATION WARNING] Users auth migration: {e}")


def _migrate_legal_drafts(db):
    """Add new columns to legal_drafts if they don't exist (for existing databases)."""
    columns_info = db.execute("PRAGMA table_info(legal_drafts)").fetchall()
    existing_cols = {col["name"] for col in columns_info}

    migrations = [
        ("document_type", "TEXT DEFAULT 'motion'"),
        ("status", "TEXT DEFAULT 'draft'"),
        ("jurisdiction_id", "TEXT"),
        ("court_name", "TEXT"),
        ("word_count", "INTEGER DEFAULT 0"),
        ("page_count", "INTEGER DEFAULT 0"),
        ("page_limit", "INTEGER"),
        ("word_limit_value", "INTEGER"),
        ("version", "INTEGER DEFAULT 1"),
        ("assigned_reviewer", "TEXT"),
        ("client_review_token", "TEXT"),
        ("client_review_expires", "TEXT"),
        ("signed_at", "TEXT"),
        ("finalized_at", "TEXT"),
        ("filed_at", "TEXT"),
        ("served_at", "TEXT"),
        ("bates_prefix", "TEXT"),
        ("bates_start", "INTEGER"),
        ("proof_of_service", "TEXT"),
        ("override_log", "TEXT DEFAULT '[]'"),
        ("last_auto_save", "TIMESTAMP"),
    ]

    for col_name, col_type in migrations:
        if col_name not in existing_cols:
            db.execute(f"ALTER TABLE legal_drafts ADD COLUMN {col_name} {col_type}")


def _create_outreach_campaign_tables(db):
    """Staged, auto-scheduled 5-step escalation campaigns — the "silence is
    evidence of bad faith" litigation strategy. Never previously captured
    here (no CREATE TABLE existed anywhere, on the live DB or in source),
    so create_campaign() would have failed outright the first time anyone
    actually used it."""
    db.executescript("""
        CREATE TABLE IF NOT EXISTS case_campaigns (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            created_by TEXT NOT NULL,
            firm_name TEXT DEFAULT '',
            firm_address TEXT DEFAULT '',
            firm_phone TEXT DEFAULT '',
            from_name TEXT DEFAULT '',
            additional_notes TEXT DEFAULT '',
            status TEXT DEFAULT 'pending_approval' CHECK(status IN ('pending_approval', 'approved', 'rejected', 'completed')),
            litigation_type TEXT DEFAULT 'Demand for Arbitration',
            campaign_type TEXT DEFAULT 'outstanding_amount',
            schedule_day_1 INTEGER DEFAULT 0,
            schedule_day_2 INTEGER DEFAULT 14,
            schedule_day_3 INTEGER DEFAULT 28,
            schedule_day_4 INTEGER DEFAULT 42,
            schedule_day_5 INTEGER DEFAULT 49,
            approved_by TEXT,
            approval_notes TEXT DEFAULT '',
            approved_at TEXT,
            approval_token TEXT,
            approval_token_expires_at TEXT,
            approval_requested_by_name TEXT,
            approval_requested_by_email TEXT,
            approval_recipient_name TEXT,
            approval_recipient_email TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (case_id) REFERENCES cases(id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        CREATE TABLE IF NOT EXISTS campaign_emails (
            id TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            step_number INTEGER NOT NULL,
            template_type TEXT NOT NULL,
            send_day INTEGER DEFAULT 0,
            subject TEXT DEFAULT '',
            body_html TEXT DEFAULT '',
            status TEXT DEFAULT 'staged' CHECK(status IN ('staged', 'ready', 'scheduled', 'sent', 'cancelled')),
            sent_at TEXT,
            tracking_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campaign_id) REFERENCES case_campaigns(id),
            FOREIGN KEY (contact_id) REFERENCES case_contacts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_campaign_emails_campaign ON campaign_emails(campaign_id, step_number);
    """)


def _create_case_collaborators_table(db):
    """External per-case collaborators (clients, co-counsel, paralegals, experts,
    witnesses, observers) invited from the "Case Team & Access" panel on a case's
    detail page. Deliberately separate from `users`/tenant membership: a collaborator
    is scoped to exactly one case via case_id + user_id, not a tenant_id match, so
    they never see the inviting firm's other cases."""
    db.executescript("""
        CREATE TABLE IF NOT EXISTS case_collaborators (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            user_id TEXT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'client',
            permissions TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'revoked')),
            invite_token TEXT,
            invited_by TEXT,
            message TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            accepted_at TEXT,
            FOREIGN KEY (case_id) REFERENCES cases(id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_case_collaborators_case ON case_collaborators(case_id);
        CREATE INDEX IF NOT EXISTS idx_case_collaborators_token ON case_collaborators(invite_token);
        CREATE INDEX IF NOT EXISTS idx_case_collaborators_user ON case_collaborators(user_id);
    """)


def _migrate_case_campaigns_approval_columns(db):
    """Adds the columns needed to email a campaign to an external approver
    (e.g. a supervisor with no LitigationSpace login) for a token-based
    public approve/reject, the same pattern already used for Gate 1/Gate 2
    billing approvals."""
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(case_campaigns)").fetchall()}
        additions = [
            "approval_token", "approval_token_expires_at",
            "approval_requested_by_name", "approval_requested_by_email",
            "approval_recipient_name", "approval_recipient_email",
        ]
        for col_name in additions:
            if col_name not in cols:
                db.execute(f"ALTER TABLE case_campaigns ADD COLUMN {col_name} TEXT")
                print(f"[MIGRATION] Added {col_name} column to case_campaigns table")
    except Exception as e:
        print(f"[MIGRATION WARNING] case_campaigns approval columns: {e}")


def _migrate_case_campaigns_type_column(db):
    """Add campaign_type if case_campaigns already existed without it."""
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(case_campaigns)").fetchall()}
        if cols and "campaign_type" not in cols:
            db.execute("ALTER TABLE case_campaigns ADD COLUMN campaign_type TEXT DEFAULT 'outstanding_amount'")
            print("[MIGRATION] Added campaign_type column to case_campaigns table")
    except Exception as e:
        print(f"[MIGRATION WARNING] case_campaigns campaign_type: {e}")


def _fix_orphaned_campaign_emails_table(db):
    """A stray, empty campaign_emails table exists on some environments with
    its FK pointing at a never-built "email_campaigns" table instead of
    case_campaigns (the table the actual code uses) — leftover from an
    earlier, abandoned naming of this feature. create_campaign() would fail
    every insert with a FOREIGN KEY constraint error against it. Only ever
    drops it if genuinely empty — never touches a table holding real rows."""
    try:
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='campaign_emails'"
        ).fetchone()
        if not row or not row["sql"] or "email_campaigns" not in row["sql"]:
            return  # doesn't exist, or already points at the right parent
        count = db.execute("SELECT COUNT(*) as n FROM campaign_emails").fetchone()["n"]
        if count > 0:
            print(f"[MIGRATION WARNING] campaign_emails has the stale email_campaigns FK but holds {count} rows — not touching it, needs manual review")
            return
        db.execute("DROP TABLE campaign_emails")
        print("[MIGRATION] Dropped empty campaign_emails table with stale email_campaigns FK — will be recreated with the correct case_campaigns FK")
    except Exception as e:
        print(f"[MIGRATION WARNING] campaign_emails orphan fix: {e}")


def _create_outreach_thread_tables(db):
    """Outreach Phase 1 — communication threading, document review/sign
    tracking, internal collaboration, and the permanent evidence trail.

    outreach_document_links: a per-recipient (not per-document) secure token
    for reviewing/signing an attached document — deliberately separate from
    documents.share_token, which is a single token per document and would
    conflate multiple debtors' activity if reused here.

    outreach_thread_events: the append-only backbone. Every tracked action
    (sent, opened, clicked, viewed, downloaded, signed, commented, note,
    participant added) is one row here — this single table drives the
    thread timeline UI, the litigation evidence export, and notifications.
    Rows are never updated or deleted, only inserted.

    outreach_thread_participants: internal LitigationSpace users watching a
    given contact's thread — never debtor/external contacts.
    """
    db.executescript("""
        CREATE TABLE IF NOT EXISTS outreach_document_links (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            mode TEXT DEFAULT 'review' CHECK(mode IN ('review', 'sign', 'wet_sign')),
            allow_download INTEGER DEFAULT 1,
            status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'opened', 'signed', 'declined', 'expired')),
            sign_token TEXT,
            view_count INTEGER DEFAULT 0,
            download_count INTEGER DEFAULT 0,
            total_view_seconds INTEGER DEFAULT 0,
            signed_file_path TEXT,
            signed_uploaded_at TEXT,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT,
            FOREIGN KEY (case_id) REFERENCES cases(id),
            FOREIGN KEY (contact_id) REFERENCES case_contacts(id),
            FOREIGN KEY (document_id) REFERENCES documents(id)
        );

        CREATE TABLE IF NOT EXISTS outreach_thread_events (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL DEFAULT 'system' CHECK(actor_type IN ('contact', 'internal_user', 'system')),
            actor_id TEXT,
            actor_name TEXT DEFAULT '',
            email_id TEXT,
            document_link_id TEXT,
            ip_address TEXT,
            user_agent TEXT,
            metadata TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (case_id) REFERENCES cases(id),
            FOREIGN KEY (contact_id) REFERENCES case_contacts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_outreach_events_contact ON outreach_thread_events(contact_id, created_at);

        CREATE TABLE IF NOT EXISTS outreach_thread_participants (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            added_by TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (contact_id) REFERENCES case_contacts(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(contact_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS outreach_thread_notes (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            author_name TEXT DEFAULT '',
            note TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (contact_id) REFERENCES case_contacts(id)
        );

        -- Email signatures — previously only existed on the live DB (created
        -- ad hoc), never captured here, so a fresh deploy would be missing
        -- this table entirely. Schema mirrors the live table exactly.
        CREATE TABLE IF NOT EXISTS email_signatures (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0,
            sender_name TEXT DEFAULT '',
            sender_title TEXT DEFAULT '',
            sender_email TEXT DEFAULT '',
            sender_phone TEXT DEFAULT '',
            company_name TEXT DEFAULT '',
            logo_url TEXT,
            website_url TEXT,
            address_line1 TEXT,
            address_line2 TEXT,
            city TEXT,
            state TEXT,
            postal_code TEXT,
            country TEXT,
            accent_color TEXT DEFAULT '#C8992A',
            layout TEXT DEFAULT 'horizontal',
            include_social INTEGER DEFAULT 0,
            linkedin_url TEXT,
            twitter_url TEXT,
            custom_html TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        );

        -- Plain-text, per-tenant overrides of the built-in email templates.
        -- custom_body holds [Bracket Token] placeholders (e.g. [Recipient Name],
        -- [Amount Owed]) substituted per-recipient at send time — never a
        -- fully-rendered snapshot, so one saved edit stays correct for every
        -- future recipient across Compose, Bulk Send, and Campaigns.
        CREATE TABLE IF NOT EXISTS email_template_custom (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            template_type TEXT NOT NULL,
            custom_subject TEXT,
            custom_body TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_by TEXT,
            UNIQUE(tenant_id, template_type)
        );
    """)


def _migrate_outreach_document_links_wet_sign_mode(db):
    """outreach_document_links.mode had a CHECK(mode IN ('review','sign'))
    constraint that rejects the new 'wet_sign' mode (download, hand-sign,
    upload a scan — required for documents like IRS Form 8821 where a
    canvas-drawn e-signature isn't IRS-valid for mail/fax filing). SQLite
    can't ALTER a CHECK constraint in place, so rebuild the table when the
    old constraint is still in effect. Also adds the two columns that
    record the uploaded signed file."""
    try:
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='outreach_document_links'"
        ).fetchone()
        if not row:
            return  # table doesn't exist yet — the CREATE TABLE above already has the right constraint
        needs_rebuild = "wet_sign" not in row["sql"]
        if needs_rebuild:
            db.executescript("""
                ALTER TABLE outreach_document_links RENAME TO outreach_document_links_old;
                CREATE TABLE outreach_document_links (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    case_id TEXT NOT NULL,
                    contact_id TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    mode TEXT DEFAULT 'review' CHECK(mode IN ('review', 'sign', 'wet_sign')),
                    allow_download INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'opened', 'signed', 'declined', 'expired')),
                    sign_token TEXT,
                    view_count INTEGER DEFAULT 0,
                    download_count INTEGER DEFAULT 0,
                    total_view_seconds INTEGER DEFAULT 0,
                    signed_file_path TEXT,
                    signed_uploaded_at TEXT,
                    created_by TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT,
                    FOREIGN KEY (case_id) REFERENCES cases(id),
                    FOREIGN KEY (contact_id) REFERENCES case_contacts(id),
                    FOREIGN KEY (document_id) REFERENCES documents(id)
                );
                INSERT INTO outreach_document_links
                    (id, tenant_id, case_id, contact_id, document_id, token, mode, allow_download,
                     status, sign_token, view_count, download_count, total_view_seconds,
                     created_by, created_at, expires_at)
                SELECT id, tenant_id, case_id, contact_id, document_id, token, mode, allow_download,
                       status, sign_token, view_count, download_count, total_view_seconds,
                       created_by, created_at, expires_at
                FROM outreach_document_links_old;
                DROP TABLE outreach_document_links_old;
                CREATE INDEX IF NOT EXISTS idx_outreach_doclinks_token ON outreach_document_links(token);
            """)
            print("[MIGRATION] Rebuilt outreach_document_links to allow 'wet_sign' mode")
        else:
            cols = {c["name"] for c in db.execute("PRAGMA table_info(outreach_document_links)").fetchall()}
            for col_name in ("signed_file_path", "signed_uploaded_at"):
                if col_name not in cols:
                    db.execute(f"ALTER TABLE outreach_document_links ADD COLUMN {col_name} TEXT")
                    print(f"[MIGRATION] Added {col_name} column to outreach_document_links table")
    except Exception as e:
        print(f"[MIGRATION WARNING] outreach_document_links wet_sign mode: {e}")


def _migrate_billing_contingency_type(db):
    """'contingency' (fee = recovery_amount x contingency_percentage) wasn't in
    the original billing_type CHECK constraints on contracts/contract_tasks.
    SQLite can't ALTER a CHECK constraint in place, so rebuild each table —
    preserving every column exactly as it currently exists, including ones
    added by later ALTER TABLE migrations — when the old constraint is still
    in effect.

    Renaming a table makes SQLite auto-rewrite OTHER tables' FOREIGN KEY
    clauses to point at the new (temporary) name — e.g. renaming contracts to
    contracts_old silently rewrites contract_tasks' FK to "contracts_old",
    which then dangles once that table is dropped. legacy_alter_table=ON
    disables that auto-rewrite for the duration of this migration, so
    dependent tables' FK text is left alone and correctly resolves once the
    new table is back under its original name."""
    try:
        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("PRAGMA legacy_alter_table=ON")
        for table, old_clause, new_clause in (
            (
                "contracts",
                "CHECK(billing_type IN ('hourly', 'flat_fee', 'mixed'))",
                "CHECK(billing_type IN ('hourly', 'flat_fee', 'mixed', 'contingency'))",
            ),
            (
                "contract_tasks",
                "CHECK(billing_type IN ('hourly', 'flat_fee'))",
                "CHECK(billing_type IN ('hourly', 'flat_fee', 'contingency'))",
            ),
        ):
            try:
                row = db.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()
                if not row:
                    continue  # table doesn't exist yet — the CREATE TABLE above already has the right constraint
                old_sql = row["sql"]
                if "'contingency'" in old_sql:
                    continue  # already migrated
                if old_clause not in old_sql:
                    print(f"[MIGRATION WARNING] {table} billing_type CHECK not found verbatim — skipping contingency rebuild")
                    continue
                new_sql = old_sql.replace(old_clause, new_clause)
                cols = [c["name"] for c in db.execute(f"PRAGMA table_info({table})").fetchall()]
                col_list = ", ".join(cols)
                db.executescript(f"""
                    ALTER TABLE {table} RENAME TO {table}_old;
                    {new_sql};
                    INSERT INTO {table} ({col_list}) SELECT {col_list} FROM {table}_old;
                    DROP TABLE {table}_old;
                """)
                print(f"[MIGRATION] Rebuilt {table} to allow 'contingency' billing_type")
            except Exception as e:
                print(f"[MIGRATION WARNING] {table} contingency billing_type: {e}")
    finally:
        db.execute("PRAGMA legacy_alter_table=OFF")
        db.execute("PRAGMA foreign_keys=ON")


def _migrate_email_template_custom_plaintext_columns(db):
    """email_template_custom pre-existed on the live DB (created ad hoc,
    never captured in a migration here) with only a custom_html column that
    was never actually applied at send time. Add the plain-text columns the
    new no-code template editor uses; custom_html is left in place but
    unused going forward."""
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(email_template_custom)").fetchall()}
        for col_name in ("custom_subject", "custom_body"):
            if col_name not in cols:
                db.execute(f"ALTER TABLE email_template_custom ADD COLUMN {col_name} TEXT")
                print(f"[MIGRATION] Added {col_name} column to email_template_custom table")
    except Exception as e:
        print(f"[MIGRATION WARNING] email_template_custom plaintext columns: {e}")


def _migrate_signature_requests_outreach_columns(db):
    """Add case_id/contact_id to signature_requests so outreach-triggered
    signature requests can be resolved back to a thread for event tracking,
    without touching the existing generic e-signature flow's behavior."""
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(signature_requests)").fetchall()}
        additions = [
            ("case_id", "TEXT"),
            ("contact_id", "TEXT"),
        ]
        for col_name, col_type in additions:
            if col_name not in cols:
                db.execute(f"ALTER TABLE signature_requests ADD COLUMN {col_name} {col_type}")
                print(f"[MIGRATION] Added {col_name} column to signature_requests table")
    except Exception as e:
        print(f"[MIGRATION WARNING] signature_requests outreach columns: {e}")


def _create_billing_tables(db):
    """Create the billing subsystem tables if they don't exist.

    These tables (contracts, contract_tasks, invoices, invoice_items,
    billing_time_entries) were previously created ad hoc directly on the
    live database and never captured here — this brings them under
    version control so a fresh deploy gets the same schema.
    """
    db.executescript("""
        CREATE TABLE IF NOT EXISTS contracts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            client_user_id TEXT,
            client_name TEXT NOT NULL,
            client_email TEXT DEFAULT '',
            created_by TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            billing_type TEXT DEFAULT 'mixed' CHECK(billing_type IN ('hourly', 'flat_fee', 'mixed', 'contingency')),
            hourly_rate REAL DEFAULT 0,
            max_hours_per_day REAL DEFAULT 0,
            max_hours_per_week REAL DEFAULT 0,
            status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'sent', 'active', 'completed', 'cancelled')),
            contract_file_url TEXT DEFAULT '',
            start_date TEXT,
            end_date TEXT,
            payment_link TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            case_id TEXT DEFAULT '' REFERENCES cases(id),
            flat_rate_amount REAL DEFAULT 0,
            amount_paid REAL DEFAULT 0 NOT NULL,
            rate_locked INTEGER DEFAULT 0,
            contingency_percentage REAL DEFAULT 0,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS contract_tasks (
            id TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            billing_type TEXT DEFAULT 'flat_fee' CHECK(billing_type IN ('hourly', 'flat_fee', 'contingency')),
            flat_fee_amount REAL DEFAULT 0,
            hourly_rate REAL DEFAULT 0,
            estimated_hours REAL DEFAULT 0,
            contingency_percentage REAL DEFAULT 0,
            recovery_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
            case_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            task_date TEXT DEFAULT NULL,
            invoiced_at TEXT DEFAULT NULL,
            invoice_id TEXT DEFAULT NULL,
            FOREIGN KEY (contract_id) REFERENCES contracts(id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            contract_id TEXT,
            invoice_number INTEGER NOT NULL,
            client_user_id TEXT,
            client_name TEXT NOT NULL,
            client_email TEXT DEFAULT '',
            issued_by_id TEXT NOT NULL,
            issued_by_name TEXT DEFAULT '',
            subtotal REAL DEFAULT 0,
            tax_rate REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0,
            total REAL DEFAULT 0,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
            due_date TEXT,
            paid_date TEXT,
            payment_link TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            metadata TEXT DEFAULT '',
            public_token TEXT DEFAULT '',
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (issued_by_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            description TEXT NOT NULL,
            item_type TEXT DEFAULT 'hourly' CHECK(item_type IN ('hourly', 'flat_fee')),
            quantity REAL DEFAULT 1,
            rate REAL DEFAULT 0,
            amount REAL DEFAULT 0,
            time_entry_id TEXT,
            task_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id)
        );

        CREATE TABLE IF NOT EXISTS billing_time_entries (
            id TEXT PRIMARY KEY,
            contract_id TEXT,
            task_id TEXT,
            case_id TEXT,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes REAL DEFAULT 0,
            description TEXT DEFAULT '',
            hourly_rate REAL DEFAULT 0,
            amount REAL DEFAULT 0,
            billable INTEGER DEFAULT 1,
            status TEXT DEFAULT 'completed' CHECK(status IN ('running', 'completed', 'invoiced')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS task_attachments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            mime_type TEXT DEFAULT '',
            size_bytes INTEGER DEFAULT 0,
            uploaded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES contract_tasks(id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
    """)


def _migrate_billing_approval_columns(db):
    """Add two-gate approval state + entity attribution columns to the billing tables."""
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(contracts)").fetchall()}
        if "rate_locked" not in cols:
            db.execute("ALTER TABLE contracts ADD COLUMN rate_locked INTEGER DEFAULT 0")
            print("[MIGRATION] Added rate_locked column to contracts table")
        if "contingency_percentage" not in cols:
            db.execute("ALTER TABLE contracts ADD COLUMN contingency_percentage REAL DEFAULT 0")
            print("[MIGRATION] Added contingency_percentage column to contracts table")
    except Exception as e:
        print(f"[MIGRATION WARNING] contracts rate_locked: {e}")

    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(contract_tasks)").fetchall()}
        additions = [
            ("entity_name", "TEXT DEFAULT ''"),
            ("scope_status", "TEXT DEFAULT 'pending'"),
            ("scope_token", "TEXT"),
            ("scope_token_expires_at", "TEXT"),
            ("scope_approved_at", "TEXT"),
            ("scope_approved_ip", "TEXT"),
            ("scope_rejected_reason", "TEXT"),
            ("billing_status", "TEXT DEFAULT 'pending'"),
            ("billing_token", "TEXT"),
            ("billing_token_expires_at", "TEXT"),
            ("billing_amount", "REAL"),
            ("billing_approved_at", "TEXT"),
            ("billing_approved_ip", "TEXT"),
            ("billing_rejected_reason", "TEXT"),
            ("target_end_date", "TEXT"),       # expected completion date, shown to client alongside task_date (start)
            ("scope_requested_by", "TEXT"),     # real name of whoever sent the scope approval request
            ("billing_requested_by", "TEXT"),   # real name of whoever sent the billing approval request
            ("scope_requested_by_email", "TEXT"),   # contractor's email — notified when scope gets approved
            ("billing_requested_by_email", "TEXT"), # contractor's email — notified when billing gets approved
            ("scope_recipient_name", "TEXT"),       # who the scope request was actually sent to (name)
            ("scope_recipient_email", "TEXT"),      # who the scope request was actually sent to (email) — confirmation sent here on approval
            ("billing_recipient_name", "TEXT"),     # who the billing request was actually sent to (name)
            ("billing_recipient_email", "TEXT"),    # who the billing request was actually sent to (email) — confirmation sent here on approval
            ("deadline_reminder_sent_at", "TEXT"),  # set once a deadline reminder has fired, so it only sends once
            ("billing_summary_text", "TEXT DEFAULT ''"),  # pasted work summary included with the Gate 2 bill send
            ("scope_query_note", "TEXT"),        # client's note when sending scope back for explanation (not a rejection)
            ("scope_queried_at", "TEXT"),         # when the client sent the scope back with a question
            ("scope_sent_at", "TEXT"),           # when the current pending scope request was sent — for "days pending" on reminders
            ("scope_reminder_count", "INTEGER DEFAULT 0"),
            ("scope_last_reminded_at", "TEXT"),
            ("billing_sent_at", "TEXT"),         # when the current pending bill was sent — for "days pending" on reminders
            ("billing_reminder_count", "INTEGER DEFAULT 0"),
            ("billing_last_reminded_at", "TEXT"),
            ("contingency_percentage", "REAL DEFAULT 0"),  # e.g. 33.33 meaning 33.33% of recovery_amount
            ("recovery_amount", "REAL DEFAULT 0"),  # settlement/judgment amount — entered once known, drives the contingency fee
        ]
        for col_name, col_type in additions:
            if col_name not in cols:
                db.execute(f"ALTER TABLE contract_tasks ADD COLUMN {col_name} {col_type}")
                print(f"[MIGRATION] Added {col_name} column to contract_tasks table")
    except Exception as e:
        print(f"[MIGRATION WARNING] contract_tasks approval columns: {e}")

    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(invoice_items)").fetchall()}
        if "entity_name" not in cols:
            db.execute("ALTER TABLE invoice_items ADD COLUMN entity_name TEXT DEFAULT ''")
            print("[MIGRATION] Added entity_name column to invoice_items table")
    except Exception as e:
        print(f"[MIGRATION WARNING] invoice_items entity_name: {e}")


def _migrate_documents_is_merged(db):
    """Add is_merged column to documents table if it doesn't exist."""
    try:
        columns_info = db.execute("PRAGMA table_info(documents)").fetchall()
        existing_cols = {col["name"] for col in columns_info}
        if "is_merged" not in existing_cols:
            db.execute("ALTER TABLE documents ADD COLUMN is_merged INTEGER DEFAULT 0")
            print("[MIGRATION] Added is_merged column to documents table")
            # Mark existing merged documents (content_text starts with 'Merged from')
            db.execute("UPDATE documents SET is_merged = 1 WHERE content_text LIKE 'Merged from %'")
            print("[MIGRATION] Backfilled is_merged for existing merged documents")
    except Exception as e:
        print(f"[MIGRATION WARNING] documents is_merged: {e}")


def _migrate_documents_exhibit_columns(db):
    """Add exhibit_label, exhibit_name, exhibit_order columns to documents table if missing."""
    try:
        columns_info = db.execute("PRAGMA table_info(documents)").fetchall()
        existing_cols = {col["name"] for col in columns_info}
        if "exhibit_label" not in existing_cols:
            db.execute("ALTER TABLE documents ADD COLUMN exhibit_label TEXT")
            print("[MIGRATION] Added exhibit_label column to documents table")
        if "exhibit_name" not in existing_cols:
            db.execute("ALTER TABLE documents ADD COLUMN exhibit_name TEXT")
            print("[MIGRATION] Added exhibit_name column to documents table")
        if "exhibit_order" not in existing_cols:
            db.execute("ALTER TABLE documents ADD COLUMN exhibit_order INTEGER")
            print("[MIGRATION] Added exhibit_order column to documents table")
    except Exception as e:
        print(f"[MIGRATION WARNING] documents exhibit columns: {e}")


def _migrate_documents_content_html(db):
    """Add content_html column to documents table for formatted HTML rendering."""
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(documents)").fetchall()}
        if "content_html" not in cols:
            db.execute("ALTER TABLE documents ADD COLUMN content_html TEXT")
            print("[MIGRATION] Added content_html column to documents table")
    except Exception as e:
        print(f"[MIGRATION WARNING] documents content_html: {e}")


def _migrate_blog_articles_status(db):
    """Add status column to blog_articles table if it doesn't exist.

    The Growth OS blog cron/admin endpoints (growth.py) write and expect a
    `status` column, but it was never part of the original CREATE TABLE and
    only existed on some deployments via manual DB patching. Fresh databases
    (e.g. a new tenant clone) were missing it, silently breaking every blog
    publish (cron and admin) with "no such column: status".
    """
    try:
        cols = {c["name"] for c in db.execute("PRAGMA table_info(blog_articles)").fetchall()}
        if "status" not in cols:
            db.execute("ALTER TABLE blog_articles ADD COLUMN status TEXT DEFAULT 'published'")
            print("[MIGRATION] Added status column to blog_articles table")
    except Exception as e:
        print(f"[MIGRATION WARNING] blog_articles status: {e}")


def _create_case_notes_table(db):
    """The case_notes table was already referenced by the case-delete cascade
    (DELETE FROM case_notes WHERE case_id = ?) and real notes existed on the
    live .com database, but there was no CREATE TABLE anywhere in source —
    it only existed there via undocumented manual DB setup. Fresh databases
    (litigationspace.org, any future clone) never had the table at all, so
    every note read/write would fail with "no such table: case_notes"."""
    db.executescript("""
        CREATE TABLE IF NOT EXISTS case_notes (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (case_id) REFERENCES cases(id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id);
    """)


def _migrate_cases_jurisdiction_fields(db):
    """Add jurisdiction, forum, matter_type, party_roles columns to cases table."""
    try:
        columns_info = db.execute("PRAGMA table_info(cases)").fetchall()
        existing_cols = {col["name"] for col in columns_info}
        new_cols = [
            ("jurisdiction", "TEXT"),
            ("forum", "TEXT"),
            ("matter_type", "TEXT"),
            ("party_roles", "TEXT"),
        ]
        for col_name, col_type in new_cols:
            if col_name not in existing_cols:
                db.execute(f"ALTER TABLE cases ADD COLUMN {col_name} {col_type}")
                print(f"[MIGRATION] Added {col_name} column to cases table")
    except Exception as e:
        print(f"[MIGRATION WARNING] cases jurisdiction fields: {e}")


def _migrate_cases_exhibit_numbering(db):
    """Add exhibit_numbering column to cases table if it doesn't exist."""
    try:
        columns_info = db.execute("PRAGMA table_info(cases)").fetchall()
        existing_cols = {col["name"] for col in columns_info}
        if "exhibit_numbering" not in existing_cols:
            db.execute("ALTER TABLE cases ADD COLUMN exhibit_numbering TEXT DEFAULT 'letters'")
            print("[MIGRATION] Added exhibit_numbering column to cases table")
    except Exception as e:
        print(f"[MIGRATION WARNING] cases exhibit_numbering: {e}")


def _migrate_users_subscription(db):
    """Add subscription, trial, and credit columns to the users table.

    New columns:
      subscription_status   — grace | trial | active | restricted | payg
      plan                  — none | basic | elite | chambers | enterprise | payg
      trial_start_date      — when the trial began
      trial_end_date        — trial_start_date + 7 days
      trial_credits_total   — 200 for all trial/grace accounts
      trial_credits_used    — increments on each AI call during trial
      subscription_credits_total     — monthly allowance for paid plans
      subscription_credits_remaining — resets on billing anniversary
      credits_reset_at      — last monthly reset timestamp
      payg_credits          — purchased credits, never expire
      subscription_activated_at — when a Zeffy payment activated the account
      grace_until           — for existing accounts: grace period end date

    Seeding rules:
      - Existing users (no subscription_status yet) → grace, grace_until = now + 7 days
      - New users are set to trial on registration by the auth router
    """
    try:
        columns_info = db.execute("PRAGMA table_info(users)").fetchall()
        existing_cols = {col["name"] for col in columns_info}

        new_columns = [
            ("subscription_status",            "TEXT DEFAULT 'trial'"),
            ("plan",                           "TEXT DEFAULT 'none'"),
            ("trial_start_date",               "TIMESTAMP"),
            ("trial_end_date",                 "TIMESTAMP"),
            ("trial_credits_total",            "INTEGER DEFAULT 200"),
            ("trial_credits_used",             "INTEGER DEFAULT 0"),
            ("subscription_credits_total",     "INTEGER DEFAULT 0"),
            ("subscription_credits_remaining", "INTEGER DEFAULT 0"),
            ("credits_reset_at",               "TIMESTAMP"),
            ("payg_credits",                   "INTEGER DEFAULT 0"),
            ("subscription_activated_at",      "TIMESTAMP"),
            ("grace_until",                    "TIMESTAMP"),
        ]

        # Also add trial_notifications_sent tracking column
        new_columns.append(("trial_notifications_sent", "TEXT DEFAULT ''"))

        for col_name, col_def in new_columns:
            if col_name not in existing_cols:
                db.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
                print(f"[MIGRATION] Added {col_name} to users table")

        # Seed all existing accounts that have no subscription_status as 'grace'
        # grace_until = current time + 7 days
        if "subscription_status" not in existing_cols:
            db.execute("""
                UPDATE users
                SET
                    subscription_status = 'grace',
                    grace_until         = datetime('now', '+7 days'),
                    trial_credits_total = 200,
                    trial_credits_used  = 0
                WHERE subscription_status IS NULL OR subscription_status = 'trial'
            """)
            count = db.execute("SELECT COUNT(*) as c FROM users WHERE subscription_status = 'grace'").fetchone()["c"]
            print(f"[MIGRATION] Seeded {count} existing users → subscription_status=grace (grace_until = now+7d)")

    except Exception as e:
        print(f"[MIGRATION WARNING] users subscription migration: {e}")


def _migrate_growth_website_id(db):
    """Phase 1 multi-site migration: add website_id to all Growth OS tables.

    Adds website_id TEXT DEFAULT 'ls' to:
      - social_posts
      - blog_articles
      - email_campaigns
      - leads_motion_analyzer
      - growth_config

    All existing rows are backfilled to 'ls' (LitigationSpace).
    Safe to run multiple times — skips columns that already exist.
    """
    tables = [
        "social_posts",
        "blog_articles",
        "email_campaigns",
        "leads_motion_analyzer",
        "growth_config",
    ]
    for table in tables:
        try:
            cols = {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
            if "website_id" not in cols:
                db.execute(f"ALTER TABLE {table} ADD COLUMN website_id TEXT DEFAULT 'ls'")
                db.execute(f"UPDATE {table} SET website_id = 'ls' WHERE website_id IS NULL")
                print(f"[MIGRATION] Added website_id to {table} and backfilled existing rows to 'ls'")
            else:
                # Column exists; still backfill any NULL rows left from a partial migration
                db.execute(f"UPDATE {table} SET website_id = 'ls' WHERE website_id IS NULL")
        except Exception as e:
            print(f"[MIGRATION WARNING] growth website_id ({table}): {e}")


def _seed_court_rules(db):
    """Seed court rules for 20+ major US courts."""
    import json
    import uuid

    existing = db.execute("SELECT COUNT(*) as cnt FROM court_rules").fetchone()["cnt"]
    if existing >= 20:
        return

    db.execute("DELETE FROM court_rules")

    courts = [
        {
            "jurisdiction_id": "us_scotus",
            "court_name": "Supreme Court of the United States",
            "pleading_paper": 0,
            "default_font": "Century Schoolbook",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.5, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"pages": 50}, "reply": {"pages": 25}, "petition": {"words": 9000}, "motion": {"words": 5000}},
            "word_limit": None,
            "caption_format": "IN THE SUPREME COURT OF THE UNITED STATES\n{case_number}\n{plaintiff},\n    Petitioner,\nv.\n{defendant},\n    Respondent.",
            "pleading_caption_template": None,
            "requires_toc": 1, "toc_threshold_pages": 10,
            "requires_toa": 1, "toa_threshold_pages": 10,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_ca_nd",
            "court_name": "U.S. District Court, Northern District of California",
            "pleading_paper": 1,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 15}, "brief": {"pages": 35}, "response": {"pages": 25}},
            "word_limit": None,
            "caption_format": "UNITED STATES DISTRICT COURT\nNORTHERN DISTRICT OF CALIFORNIA\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCase No. {case_number}\n\n{document_title}",
            "pleading_caption_template": "28-line numbered pleading paper",
            "requires_toc": 1, "toc_threshold_pages": 15,
            "requires_toa": 1, "toa_threshold_pages": 15,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_ca_cd",
            "court_name": "U.S. District Court, Central District of California",
            "pleading_paper": 1,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 15}, "brief": {"pages": 30}, "response": {"pages": 25}},
            "word_limit": None,
            "caption_format": "UNITED STATES DISTRICT COURT\nCENTRAL DISTRICT OF CALIFORNIA\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCase No. {case_number}",
            "pleading_caption_template": "28-line numbered pleading paper",
            "requires_toc": 1, "toc_threshold_pages": 15,
            "requires_toa": 1, "toa_threshold_pages": 15,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_ny_sd",
            "court_name": "U.S. District Court, Southern District of New York",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 10}, "brief": {"pages": 30}, "response": {"pages": 25}},
            "word_limit": None,
            "caption_format": "UNITED STATES DISTRICT COURT\nSOUTHERN DISTRICT OF NEW YORK\n\n{plaintiff},\n    Plaintiff,\n  -against-\n{defendant},\n    Defendant.\n\n{case_number}",
            "pleading_caption_template": None,
            "requires_toc": 1, "toc_threshold_pages": 15,
            "requires_toa": 1, "toa_threshold_pages": 15,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_ny_ed",
            "court_name": "U.S. District Court, Eastern District of New York",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 10}, "brief": {"pages": 30}},
            "word_limit": None,
            "caption_format": "UNITED STATES DISTRICT COURT\nEASTERN DISTRICT OF NEW YORK\n\n{plaintiff},\n    Plaintiff,\n  -against-\n{defendant},\n    Defendant.\n\n{case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_tx_sd",
            "court_name": "U.S. District Court, Southern District of Texas",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 20}, "msj": {"pages": 30}, "reply": {"pages": 10}, "brief": {"pages": 25}},
            "word_limit": None,
            "caption_format": "IN THE UNITED STATES DISTRICT COURT\nFOR THE SOUTHERN DISTRICT OF TEXAS\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCivil Action No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_tx_nd",
            "court_name": "U.S. District Court, Northern District of Texas",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 15}, "brief": {"pages": 30}},
            "word_limit": None,
            "caption_format": "IN THE UNITED STATES DISTRICT COURT\nFOR THE NORTHERN DISTRICT OF TEXAS\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCivil Action No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_il_nd",
            "court_name": "U.S. District Court, Northern District of Illinois",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 15}, "msj": {"pages": 15}, "reply": {"pages": 10}, "brief": {"pages": 25}},
            "word_limit": None,
            "caption_format": "IN THE UNITED STATES DISTRICT COURT\nFOR THE NORTHERN DISTRICT OF ILLINOIS\nEASTERN DIVISION\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCase No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 20,
            "requires_toa": 0, "toa_threshold_pages": 20,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_fl_sd",
            "court_name": "U.S. District Court, Southern District of Florida",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 20}, "msj": {"pages": 20}, "reply": {"pages": 10}, "brief": {"pages": 25}},
            "word_limit": None,
            "caption_format": "UNITED STATES DISTRICT COURT\nSOUTHERN DISTRICT OF FLORIDA\n\n{plaintiff},\n    Plaintiff,\nvs.\n{defendant},\n    Defendant.\n\nCASE NO. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_dc",
            "court_name": "U.S. District Court, District of Columbia",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 45, "words": 10000}, "msj": {"pages": 45, "words": 10000}, "reply": {"pages": 25, "words": 5000}, "brief": {"pages": 45}},
            "word_limit": None,
            "caption_format": "UNITED STATES DISTRICT COURT\nFOR THE DISTRICT OF COLUMBIA\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCivil Action No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 1, "toc_threshold_pages": 15,
            "requires_toa": 1, "toa_threshold_pages": 15,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_ca_9cir",
            "court_name": "U.S. Court of Appeals, Ninth Circuit",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 14,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"words": 14000}, "reply": {"words": 7000}, "petition": {"words": 4200}, "motion": {"words": 5200}},
            "word_limit": 14000,
            "caption_format": "UNITED STATES COURT OF APPEALS\nFOR THE NINTH CIRCUIT\n\n{plaintiff},\n    Plaintiff-Appellant,\nv.\n{defendant},\n    Defendant-Appellee.\n\nNo. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 1, "toc_threshold_pages": 1,
            "requires_toa": 1, "toa_threshold_pages": 1,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_ny_2cir",
            "court_name": "U.S. Court of Appeals, Second Circuit",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 14,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"words": 14000}, "reply": {"words": 7000}, "motion": {"words": 5200}},
            "word_limit": 14000,
            "caption_format": "UNITED STATES COURT OF APPEALS\nFOR THE SECOND CIRCUIT\n\nDocket No. {case_number}\n\n{plaintiff},\n    Plaintiff-Appellant,\nv.\n{defendant},\n    Defendant-Appellee.",
            "pleading_caption_template": None,
            "requires_toc": 1, "toc_threshold_pages": 1,
            "requires_toa": 1, "toa_threshold_pages": 1,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "us_tx_5cir",
            "court_name": "U.S. Court of Appeals, Fifth Circuit",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 14,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"words": 13000}, "reply": {"words": 6500}, "motion": {"pages": 20}},
            "word_limit": 13000,
            "caption_format": "IN THE UNITED STATES COURT OF APPEALS\nFOR THE FIFTH CIRCUIT\n\nNo. {case_number}\n\n{plaintiff},\n    Plaintiff-Appellant,\nversus\n{defendant},\n    Defendant-Appellee.",
            "pleading_caption_template": None,
            "requires_toc": 1, "toc_threshold_pages": 1,
            "requires_toa": 1, "toa_threshold_pages": 1,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "ca_state_la_superior",
            "court_name": "Superior Court of California, County of Los Angeles",
            "pleading_paper": 1,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 0.5, "margin_left": 1.0, "margin_right": 0.5,
            "doc_type_limits": {"motion": {"pages": 15}, "msj": {"pages": 20}, "reply": {"pages": 10}, "brief": {"pages": 25}, "petition": {"pages": 15}},
            "word_limit": None,
            "caption_format": "SUPERIOR COURT OF THE STATE OF CALIFORNIA\nFOR THE COUNTY OF LOS ANGELES\n\n{plaintiff},\n    Plaintiff,\nvs.\n{defendant},\n    Defendant.\n\nCase No. {case_number}\n\n{document_title}",
            "pleading_caption_template": "28-line numbered pleading paper, line numbers on left margin",
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "ca_state_sf_superior",
            "court_name": "Superior Court of California, City and County of San Francisco",
            "pleading_paper": 1,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 0.5, "margin_left": 1.0, "margin_right": 0.5,
            "doc_type_limits": {"motion": {"pages": 15}, "msj": {"pages": 20}, "reply": {"pages": 10}},
            "word_limit": None,
            "caption_format": "SUPERIOR COURT OF THE STATE OF CALIFORNIA\nCITY AND COUNTY OF SAN FRANCISCO\n\n{plaintiff},\n    Plaintiff,\nvs.\n{defendant},\n    Defendant.\n\nCase No. {case_number}",
            "pleading_caption_template": "28-line numbered pleading paper",
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "ny_state_supreme",
            "court_name": "Supreme Court of the State of New York",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 15}, "brief": {"pages": 30}, "affidavit": {"pages": None}},
            "word_limit": None,
            "caption_format": "SUPREME COURT OF THE STATE OF NEW YORK\nCOUNTY OF {county}\n\n{plaintiff},\n    Plaintiff,\n-against-\n{defendant},\n    Defendant.\n\nIndex No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "tx_state_district",
            "court_name": "District Court of Texas",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 20}, "msj": {"pages": 20}, "reply": {"pages": 10}, "brief": {"pages": 30}},
            "word_limit": None,
            "caption_format": "IN THE DISTRICT COURT OF {county} COUNTY, TEXAS\n{court_number} JUDICIAL DISTRICT\n\n{plaintiff},\n    Plaintiff,\nv.\n{defendant},\n    Defendant.\n\nCause No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "fl_state_circuit",
            "court_name": "Circuit Court of Florida",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "msj": {"pages": 25}, "reply": {"pages": 15}},
            "word_limit": None,
            "caption_format": "IN THE CIRCUIT COURT OF THE {circuit} JUDICIAL CIRCUIT\nIN AND FOR {county} COUNTY, FLORIDA\n\n{plaintiff},\n    Plaintiff,\nvs.\n{defendant},\n    Defendant.\n\nCase No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "aaa_arbitration",
            "court_name": "American Arbitration Association (AAA)",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"pages": 30}, "motion": {"pages": 20}, "reply": {"pages": 15}},
            "word_limit": None,
            "caption_format": "BEFORE THE AMERICAN ARBITRATION ASSOCIATION\n\n{plaintiff},\n    Claimant,\nvs.\n{defendant},\n    Respondent.\n\nAAA Case No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 30,
            "requires_toa": 0, "toa_threshold_pages": 30,
            "requires_certificate_of_service": 1,
        },
        {
            "jurisdiction_id": "jams_arbitration",
            "court_name": "JAMS",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"pages": 25}, "motion": {"pages": 20}, "reply": {"pages": 15}},
            "word_limit": None,
            "caption_format": "BEFORE JAMS\n\n{plaintiff},\n    Claimant,\nvs.\n{defendant},\n    Respondent.\n\nJAMS Reference No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 30,
            "requires_toa": 0, "toa_threshold_pages": 30,
            "requires_certificate_of_service": 0,
        },
        {
            "jurisdiction_id": "jams_mediation",
            "court_name": "JAMS Mediation",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"brief": {"pages": 20}, "motion": {"pages": 15}},
            "word_limit": None,
            "caption_format": "BEFORE JAMS MEDIATION\n\n{plaintiff},\n    Party A,\nvs.\n{defendant},\n    Party B.\n\nJAMS Ref. No. {case_number}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 30,
            "requires_toa": 0, "toa_threshold_pages": 30,
            "requires_certificate_of_service": 0,
        },
        {
            "jurisdiction_id": "uscis_immigration",
            "court_name": "USCIS Service Center",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 1.5,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"petition": {"pages": None}, "brief": {"pages": 30}, "response": {"pages": None}},
            "word_limit": None,
            "caption_format": "U.S. Citizenship and Immigration Services\n{service_center}\n\nRe: {plaintiff}\nReceipt Number: {case_number}\n\n{document_title}",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 30,
            "requires_toa": 0, "toa_threshold_pages": 30,
            "requires_certificate_of_service": 0,
        },
        {
            "jurisdiction_id": "immigration_court",
            "court_name": "Immigration Court (EOIR)",
            "pleading_paper": 0,
            "default_font": "Times New Roman",
            "font_size": 12,
            "line_spacing": 2.0,
            "margin_top": 1.0, "margin_bottom": 1.0, "margin_left": 1.0, "margin_right": 1.0,
            "doc_type_limits": {"motion": {"pages": 25}, "brief": {"pages": 25}, "response": {"pages": 25}},
            "word_limit": None,
            "caption_format": "UNITED STATES DEPARTMENT OF JUSTICE\nEXECUTIVE OFFICE FOR IMMIGRATION REVIEW\nIMMIGRATION COURT\n\nIn the Matter of:\n{plaintiff},\n    Respondent.\n\nA# {case_number}\n\nIn Removal Proceedings",
            "pleading_caption_template": None,
            "requires_toc": 0, "toc_threshold_pages": 25,
            "requires_toa": 0, "toa_threshold_pages": 25,
            "requires_certificate_of_service": 1,
        },
    ]

    for court in courts:
        court_id = str(uuid.uuid4())[:12]
        db.execute(
            """INSERT INTO court_rules (id, jurisdiction_id, court_name, pleading_paper, default_font,
               font_size, line_spacing, margin_top, margin_bottom, margin_left, margin_right,
               doc_type_limits, word_limit, caption_format, pleading_caption_template,
               requires_toc, toc_threshold_pages, requires_toa, toa_threshold_pages,
               requires_certificate_of_service)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (court_id, court["jurisdiction_id"], court["court_name"], court["pleading_paper"],
             court["default_font"], court["font_size"], court["line_spacing"],
             court["margin_top"], court["margin_bottom"], court["margin_left"], court["margin_right"],
             json.dumps(court["doc_type_limits"]), court["word_limit"],
             court["caption_format"], court["pleading_caption_template"],
             court["requires_toc"], court["toc_threshold_pages"],
             court["requires_toa"], court["toa_threshold_pages"],
             court["requires_certificate_of_service"])
        )

"""
Safari Session Service
=======================
Service layer for managing Safari automation sessions with database persistence.

Features (SSM):
- SSM-002: Safari Accounts Table - Multi-account registry
- SSM-003: Session Logs Table - Comprehensive event logging
- SSM-004: Multi-Account Registry - Track multiple accounts per platform
- SSM-005: Account Switching API - Switch between accounts
- SSM-015: Session Status API - Get session health status

This service bridges the SafariSessionManager (automation logic) with the
database (persistence layer).
"""

import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from uuid import UUID, uuid4
from loguru import logger
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
import os

# Import the automation layer
from automation.safari_session_manager import (
    SafariSessionManager,
    Platform,
    SessionState
)


class SafariSessionService:
    """
    Safari Session Service

    Manages Safari automation sessions with database persistence.

    Usage:
        service = SafariSessionService.get_instance()

        # Register an account
        account_id = await service.register_account(
            platform="twitter",
            username="@isaiah_dupree",
            display_name="Isaiah Dupree"
        )

        # Check session status
        status = await service.get_session_status(account_id)

        # Get all accounts for a platform
        accounts = await service.get_platform_accounts("twitter")
    """

    _instance: Optional["SafariSessionService"] = None

    def __init__(self):
        """Initialize Safari Session Service"""
        if SafariSessionService._instance is not None:
            raise RuntimeError("Use SafariSessionService.get_instance()")

        # Database connection
        DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
        self.engine = create_engine(DATABASE_URL)

        # Safari Session Manager (automation layer)
        self.session_manager = SafariSessionManager()

        logger.info("🌐 Safari Session Service initialized")

    @classmethod
    def get_instance(cls) -> "SafariSessionService":
        """Get singleton instance"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # =========================================================================
    # ACCOUNT MANAGEMENT (SSM-002, SSM-004)
    # =========================================================================

    async def register_account(
        self,
        platform: str,
        username: str,
        display_name: Optional[str] = None,
        refresh_interval_minutes: int = 30,
        auto_refresh: bool = True,
        priority: int = 0,
        user_id: Optional[UUID] = None
    ) -> UUID:
        """
        Register a new account in the Safari session registry (SSM-004)

        Args:
            platform: Platform name (twitter, tiktok, instagram, etc.)
            username: Platform username
            display_name: Display name for the account
            refresh_interval_minutes: How often to refresh session (minutes)
            auto_refresh: Whether to auto-refresh
            priority: Priority level (higher = more important)
            user_id: Optional user ID (defaults to system user)

        Returns:
            Account UUID

        Raises:
            ValueError: If account already exists or invalid platform
        """
        # Validate platform
        try:
            Platform(platform.lower())
        except ValueError:
            raise ValueError(f"Invalid platform: {platform}. Valid platforms: {[p.value for p in Platform]}")

        loop = asyncio.get_event_loop()

        def _register():
            with self.engine.connect() as conn:
                # Check if account already exists
                result = conn.execute(
                    text("""
                        SELECT id FROM safari_accounts
                        WHERE platform = :platform AND username = :username
                    """),
                    {"platform": platform.lower(), "username": username}
                ).fetchone()

                if result:
                    raise ValueError(f"Account already exists: {username} on {platform}")

                # Insert new account
                account_id = uuid4()
                conn.execute(
                    text("""
                        INSERT INTO safari_accounts (
                            id, user_id, platform, username, display_name,
                            refresh_interval_minutes, auto_refresh, priority
                        ) VALUES (
                            :id, :user_id, :platform, :username, :display_name,
                            :refresh_interval, :auto_refresh, :priority
                        )
                    """),
                    {
                        "id": account_id,
                        "user_id": user_id or UUID("00000000-0000-0000-0000-000000000000"),
                        "platform": platform.lower(),
                        "username": username,
                        "display_name": display_name or username,
                        "refresh_interval": refresh_interval_minutes,
                        "auto_refresh": auto_refresh,
                        "priority": priority
                    }
                )
                conn.commit()

                # Log the registration
                self._log_session_event(
                    account_id=account_id,
                    event_type="account_registered",
                    status="success",
                    details={"username": username, "platform": platform}
                )

                logger.info(f"✓ Registered account: {username} on {platform} (ID: {account_id})")
                return account_id

        return await loop.run_in_executor(None, _register)

    async def get_account(self, account_id: UUID) -> Optional[Dict[str, Any]]:
        """
        Get account details by ID

        Args:
            account_id: Account UUID

        Returns:
            Account dictionary or None if not found
        """
        loop = asyncio.get_event_loop()

        def _get():
            with self.engine.connect() as conn:
                result = conn.execute(
                    text("""
                        SELECT * FROM safari_accounts WHERE id = :id
                    """),
                    {"id": account_id}
                ).fetchone()

                if not result:
                    return None

                return dict(result._mapping)

        return await loop.run_in_executor(None, _get)

    async def get_platform_accounts(
        self,
        platform: str,
        active_only: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get all accounts for a platform (SSM-004)

        Args:
            platform: Platform name
            active_only: Only return active accounts

        Returns:
            List of account dictionaries
        """
        loop = asyncio.get_event_loop()

        def _get():
            with self.engine.connect() as conn:
                query = """
                    SELECT * FROM safari_accounts
                    WHERE platform = :platform
                """
                if active_only:
                    query += " AND is_active = true"
                query += " ORDER BY priority DESC, created_at ASC"

                result = conn.execute(
                    text(query),
                    {"platform": platform.lower()}
                ).fetchall()

                return [dict(row._mapping) for row in result]

        return await loop.run_in_executor(None, _get)

    async def get_all_accounts(self) -> List[Dict[str, Any]]:
        """
        Get all registered accounts across all platforms

        Returns:
            List of account dictionaries
        """
        loop = asyncio.get_event_loop()

        def _get():
            with self.engine.connect() as conn:
                result = conn.execute(
                    text("""
                        SELECT * FROM safari_accounts
                        ORDER BY platform, priority DESC, created_at ASC
                    """)
                ).fetchall()

                return [dict(row._mapping) for row in result]

        return await loop.run_in_executor(None, _get)

    async def update_account_status(
        self,
        account_id: UUID,
        is_logged_in: bool,
        indicator_found: Optional[str] = None,
        error: Optional[str] = None
    ) -> None:
        """
        Update account login status after a check

        Args:
            account_id: Account UUID
            is_logged_in: Whether logged in
            indicator_found: CSS selector that was found
            error: Error message if check failed
        """
        loop = asyncio.get_event_loop()

        def _update():
            with self.engine.connect() as conn:
                now = datetime.now(timezone.utc)

                # Update account status
                conn.execute(
                    text("""
                        UPDATE safari_accounts
                        SET is_logged_in = :is_logged_in,
                            last_check = :last_check
                        WHERE id = :id
                    """),
                    {
                        "id": account_id,
                        "is_logged_in": is_logged_in,
                        "last_check": now
                    }
                )
                conn.commit()

                # Log the check
                self._log_session_event(
                    account_id=account_id,
                    event_type="login_check",
                    status="success" if is_logged_in else ("failed" if error else "logged_out"),
                    details={
                        "is_logged_in": is_logged_in,
                        "indicator_found": indicator_found
                    },
                    error_message=error,
                    indicator_found=indicator_found
                )

        await loop.run_in_executor(None, _update)

    async def set_active_account(
        self,
        platform: str,
        account_id: UUID
    ) -> None:
        """
        Set an account as the active account for a platform (SSM-005)

        Deactivates all other accounts for the platform and activates this one.

        Args:
            platform: Platform name
            account_id: Account UUID to activate
        """
        loop = asyncio.get_event_loop()

        def _set_active():
            with self.engine.connect() as conn:
                # Deactivate all accounts for this platform
                conn.execute(
                    text("""
                        UPDATE safari_accounts
                        SET is_active = false
                        WHERE platform = :platform
                    """),
                    {"platform": platform.lower()}
                )

                # Activate the specified account
                conn.execute(
                    text("""
                        UPDATE safari_accounts
                        SET is_active = true
                        WHERE id = :id
                    """),
                    {"id": account_id}
                )
                conn.commit()

                logger.info(f"✓ Activated account {account_id} for {platform}")

        await loop.run_in_executor(None, _set_active)

    # =========================================================================
    # SESSION LOGGING (SSM-003)
    # =========================================================================

    def _log_session_event(
        self,
        account_id: UUID,
        event_type: str,
        status: str,
        details: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
        indicator_found: Optional[str] = None,
        duration_ms: Optional[int] = None,
        url: Optional[str] = None
    ) -> None:
        """
        Log a session event to the database (SSM-003)

        Args:
            account_id: Account UUID
            event_type: Event type (login_check, session_refresh, etc.)
            status: Event status (success, failed, warning, info)
            details: Additional details as JSON
            error_message: Error message if failed
            indicator_found: CSS selector found
            duration_ms: Operation duration in milliseconds
            url: URL visited
        """
        try:
            with self.engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO safari_session_logs (
                            account_id, event_type, status, details,
                            error_message, indicator_found, duration_ms, url
                        ) VALUES (
                            :account_id, :event_type, :status, :details,
                            :error_message, :indicator_found, :duration_ms, :url
                        )
                    """),
                    {
                        "account_id": account_id,
                        "event_type": event_type,
                        "status": status,
                        "details": details,
                        "error_message": error_message,
                        "indicator_found": indicator_found,
                        "duration_ms": duration_ms,
                        "url": url
                    }
                )
                conn.commit()
        except Exception as e:
            logger.error(f"Failed to log session event: {e}")

    async def get_session_logs(
        self,
        account_id: Optional[UUID] = None,
        event_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get session logs with optional filtering

        Args:
            account_id: Filter by account ID
            event_type: Filter by event type
            status: Filter by status
            limit: Maximum number of logs to return

        Returns:
            List of log dictionaries
        """
        loop = asyncio.get_event_loop()

        def _get():
            with self.engine.connect() as conn:
                query = "SELECT * FROM safari_session_logs WHERE 1=1"
                params = {}

                if account_id:
                    query += " AND account_id = :account_id"
                    params["account_id"] = account_id

                if event_type:
                    query += " AND event_type = :event_type"
                    params["event_type"] = event_type

                if status:
                    query += " AND status = :status"
                    params["status"] = status

                query += " ORDER BY created_at DESC LIMIT :limit"
                params["limit"] = limit

                result = conn.execute(text(query), params).fetchall()
                return [dict(row._mapping) for row in result]

        return await loop.run_in_executor(None, _get)

    # =========================================================================
    # SESSION STATUS (SSM-015)
    # =========================================================================

    async def get_session_health(self) -> Dict[str, Any]:
        """
        Get overall session health status (SSM-015, SSM-001)

        Returns:
            Dictionary with session health metrics
        """
        accounts = await self.get_all_accounts()

        # Group by platform
        by_platform = {}
        for account in accounts:
            platform = account["platform"]
            if platform not in by_platform:
                by_platform[platform] = []
            by_platform[platform].append(account)

        # Calculate health metrics
        total_accounts = len(accounts)
        logged_in_count = sum(1 for a in accounts if a["is_logged_in"])
        active_count = sum(1 for a in accounts if a["is_active"])

        # Platform status
        platform_status = []
        for platform, platform_accounts in by_platform.items():
            active_account = next((a for a in platform_accounts if a["is_active"]), None)

            if active_account:
                # Check staleness
                last_check = active_account["last_check"]
                refresh_interval = active_account["refresh_interval_minutes"]

                status = "active"
                if not active_account["is_logged_in"]:
                    status = "expired"
                elif last_check:
                    minutes_since_check = (datetime.now(timezone.utc) - last_check).total_seconds() / 60
                    if minutes_since_check > refresh_interval * 1.5:
                        status = "stale"

                platform_status.append({
                    "platform": platform,
                    "username": active_account["username"],
                    "display_name": active_account["display_name"],
                    "status": status,
                    "is_logged_in": active_account["is_logged_in"],
                    "last_check": last_check.isoformat() if last_check else None,
                    "last_refresh": active_account["last_refresh"].isoformat() if active_account["last_refresh"] else None,
                    "account_count": len(platform_accounts)
                })
            else:
                platform_status.append({
                    "platform": platform,
                    "status": "no_active_account",
                    "account_count": len(platform_accounts)
                })

        return {
            "total_accounts": total_accounts,
            "logged_in_count": logged_in_count,
            "active_count": active_count,
            "platforms": platform_status,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }


# Singleton accessor
def get_safari_session_service() -> SafariSessionService:
    """Get the singleton Safari Session Service instance"""
    return SafariSessionService.get_instance()

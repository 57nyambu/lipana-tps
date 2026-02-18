# SPDX-License-Identifier: Apache-2.0
"""
Pydantic models for request/response validation.
Models mirror the ISO 20022 pacs.002.001.12 structure exactly as
required by the Tazama TMS service.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


# ------------------------------------------------------------------ #
#  ISO 20022  pacs.002 nested models
# ------------------------------------------------------------------ #

class Amount(BaseModel):
    Amt: float
    Ccy: str = "USD"


class MemberIdentification(BaseModel):
    MmbId: str


class ClearingSystemMember(BaseModel):
    ClrSysMmbId: MemberIdentification


class FinancialInstitutionId(BaseModel):
    FinInstnId: ClearingSystemMember


class ChargeInfo(BaseModel):
    Amt: Amount
    Agt: FinancialInstitutionId


class TransactionStatus(BaseModel):
    OrgnlInstrId: str = Field(default_factory=lambda: uuid4().hex)
    OrgnlEndToEndId: str = Field(default_factory=lambda: uuid4().hex)
    TxSts: str = "ACCC"
    ChrgsInf: list[ChargeInfo] = []
    AccptncDtTm: str = Field(
        default_factory=lambda: datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    )
    InstgAgt: FinancialInstitutionId | None = None
    InstdAgt: FinancialInstitutionId | None = None


class GroupHeader(BaseModel):
    MsgId: str = Field(default_factory=lambda: uuid4().hex)
    CreDtTm: str = Field(
        default_factory=lambda: datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    )


class FIToFIPmtSts(BaseModel):
    GrpHdr: GroupHeader
    TxInfAndSts: TransactionStatus


class Pacs002Payload(BaseModel):
    """Full pacs.002.001.12 body exactly as Tazama TMS expects."""
    FIToFIPmtSts: FIToFIPmtSts


# ------------------------------------------------------------------ #
#  Simplified entry request — our friendly wrapper
# ------------------------------------------------------------------ #

class SimpleTransactionRequest(BaseModel):
    """
    A human-friendly request body.  Lipana-TPS will transform this
    into the full ISO 20022 pacs.002 structure before forwarding to TMS.
    """
    debtor_member: str = Field(
        ..., description="DFSP / member ID of the debtor (sender)", examples=["dfsp001"]
    )
    creditor_member: str = Field(
        ..., description="DFSP / member ID of the creditor (receiver)", examples=["dfsp002"]
    )
    amount: float = Field(..., gt=0, description="Transaction amount", examples=[100.50])
    currency: str = Field(default="USD", description="ISO 4217 currency code")
    status: str = Field(
        default="ACCC",
        description="Transaction status: ACCC (accepted) or RJCT (rejected)",
        pattern="^(ACCC|RJCT)$",
    )
    tenant_id: str | None = Field(
        default=None, description="Tenant ID (defaults to server setting)"
    )

    def to_pacs008(self, tenant_id: str, end_to_end_id: str | None = None) -> dict[str, Any]:
        """Build the pacs.008 (credit transfer) that must be sent BEFORE pacs.002.

        Note: TenantId must NOT be in the body — Tazama TMS schema uses
        ``"not": {"required": ["TenantId"]}`` and the middleware sets
        TenantId from the auth header / x-tenant-id header instead.
        """
        now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
        e2e_id = end_to_end_id or uuid4().hex
        debtor_entity_id = uuid4().hex
        creditor_entity_id = uuid4().hex
        debtor_acct_id = uuid4().hex
        creditor_acct_id = uuid4().hex
        return {
            "TxTp": "pacs.008.001.10",
            "FIToFICstmrCdtTrf": {
                "GrpHdr": {
                    "MsgId": uuid4().hex,
                    "CreDtTm": now,
                    "NbOfTxs": 1,
                    "SttlmInf": {"SttlmMtd": "CLRG"},
                },
                "CdtTrfTxInf": {
                    "PmtId": {
                        "InstrId": uuid4().hex,
                        "EndToEndId": e2e_id,
                    },
                    "IntrBkSttlmAmt": {"Amt": {"Amt": self.amount, "Ccy": self.currency}},
                    "InstdAmt": {"Amt": {"Amt": self.amount, "Ccy": self.currency}},
                    "XchgRate": "1",
                    "ChrgBr": "DEBT",
                    "ChrgsInf": {
                        "Amt": {"Amt": 0, "Ccy": self.currency},
                        "Agt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.debtor_member}}},
                    },
                    "InitgPty": {
                        "Nm": "Debtor Name",
                        "Id": {
                            "PrvtId": {
                                "DtAndPlcOfBirth": {
                                    "BirthDt": "1990-01-01",
                                    "CityOfBirth": "Unknown",
                                    "CtryOfBirth": "ZZ",
                                },
                                "Othr": [{"Id": debtor_entity_id, "SchmeNm": {"Prtry": "TAZAMA_EID"}}],
                            }
                        },
                        "CtctDtls": {"MobNb": "+27-000000000"},
                    },
                    "Dbtr": {
                        "Nm": "Debtor Name",
                        "Id": {
                            "PrvtId": {
                                "DtAndPlcOfBirth": {
                                    "BirthDt": "1990-01-01",
                                    "CityOfBirth": "Unknown",
                                    "CtryOfBirth": "ZZ",
                                },
                                "Othr": [{"Id": debtor_entity_id, "SchmeNm": {"Prtry": "TAZAMA_EID"}}],
                            }
                        },
                        "CtctDtls": {"MobNb": "+27-000000000"},
                    },
                    "DbtrAcct": {
                        "Id": {"Othr": [{"Id": debtor_acct_id, "SchmeNm": {"Prtry": "MSISDN"}}]},
                        "Nm": "Debtor Account",
                    },
                    "DbtrAgt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.debtor_member}}},
                    "CdtrAgt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.creditor_member}}},
                    "Cdtr": {
                        "Nm": "Creditor Name",
                        "Id": {
                            "PrvtId": {
                                "DtAndPlcOfBirth": {
                                    "BirthDt": "1985-06-15",
                                    "CityOfBirth": "Unknown",
                                    "CtryOfBirth": "ZZ",
                                },
                                "Othr": [{"Id": creditor_entity_id, "SchmeNm": {"Prtry": "TAZAMA_EID"}}],
                            }
                        },
                        "CtctDtls": {"MobNb": "+27-111111111"},
                    },
                    "CdtrAcct": {
                        "Id": {"Othr": [{"Id": creditor_acct_id, "SchmeNm": {"Prtry": "MSISDN"}}]},
                        "Nm": "Creditor Account",
                    },
                    "Purp": {"Cd": "MP2P"},
                },
                "RgltryRptg": {"Dtls": {"Tp": "BALANCE OF PAYMENTS", "Cd": "100"}},
                "RmtInf": {"Ustrd": "Payment transfer"},
                "SplmtryData": {
                    "Envlp": {
                        "Doc": {
                            "Xprtn": now,
                            "InitgPty": {
                                "Glctn": {"Lat": "-3.1609", "Long": "38.3588"},
                            },
                        }
                    }
                },
            },
        }

    def to_pacs002(self, tenant_id: str, end_to_end_id: str | None = None) -> dict[str, Any]:
        """Convert to the full pacs.002 dict that TMS expects.

        Note: TenantId must NOT be in the body — Tazama TMS schema uses
        ``"not": {"required": ["TenantId"]}`` and the middleware sets
        TenantId from the auth header / x-tenant-id header instead.
        """
        now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
        msg_id = uuid4().hex
        e2e_id = end_to_end_id or uuid4().hex
        return {
            "TxTp": "pacs.002.001.12",
            "FIToFIPmtSts": {
                "GrpHdr": {
                    "MsgId": msg_id,
                    "CreDtTm": now,
                },
                "TxInfAndSts": {
                    "OrgnlInstrId": uuid4().hex,
                    "OrgnlEndToEndId": e2e_id,
                    "TxSts": self.status,
                    "ChrgsInf": [
                        {
                            "Amt": {"Amt": self.amount, "Ccy": self.currency},
                            "Agt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.debtor_member}}},
                        },
                        {
                            "Amt": {"Amt": 0, "Ccy": self.currency},
                            "Agt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.debtor_member}}},
                        },
                        {
                            "Amt": {"Amt": 0, "Ccy": self.currency},
                            "Agt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.creditor_member}}},
                        },
                    ],
                    "AccptncDtTm": now,
                    "InstgAgt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.debtor_member}}},
                    "InstdAgt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": self.creditor_member}}},
                },
            },
        }

    def resolved_tenant(self, fallback: str) -> str:
        return self.tenant_id or fallback


# ------------------------------------------------------------------ #
#  Passthrough request — send raw pacs.002 directly
# ------------------------------------------------------------------ #

class RawPacs002Request(BaseModel):
    """Send a raw pacs.002 payload directly — no transformation."""
    payload: Pacs002Payload
    tenant_id: str | None = None


# ------------------------------------------------------------------ #
#  Response models
# ------------------------------------------------------------------ #

class TransactionSubmitResponse(BaseModel):
    success: bool
    message: str
    msg_id: str
    end_to_end_id: str | None = None
    pacs008_msg_id: str | None = None
    tms_response: dict[str, Any] | None = None


class EvaluationDetail(BaseModel):
    id: int | None = None
    transaction_id: str | None = None
    status: str | None = None
    evaluation_id: str | None = None
    evaluated_at: str | None = None
    processing_time_ns: str | None = None
    typology_results: Any = None


class EvaluationListResponse(BaseModel):
    tenant_id: str
    total: int
    page: int
    per_page: int
    results: list[EvaluationDetail]


class StatsResponse(BaseModel):
    tenant_id: str
    evaluations_total: int
    alerts: int
    no_alerts: int
    event_history_transactions: int


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "lipana-tps"
    databases: dict[str, str] = {}

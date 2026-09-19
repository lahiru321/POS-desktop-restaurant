package com.lumora.pos.cashsession.service;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.cashsession.dto.CashSessionDtos.CashSessionResponse;
import com.lumora.pos.cashsession.dto.CashSessionDtos.EndShiftRequest;
import com.lumora.pos.cashsession.dto.CashSessionDtos.StartShiftRequest;
import com.lumora.pos.cashsession.entity.CashSessionEntity;
import com.lumora.pos.cashsession.repository.CashSessionRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.common.exception.ResourceNotFoundException;
import com.lumora.pos.credit.repository.CreditTransactionRepository;
import com.lumora.pos.employee.entity.TimeRecord;
import com.lumora.pos.employee.repository.TimeRecordRepository;
import com.lumora.pos.returns.repository.ReturnRepository;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class CashSessionService {

    private final CashSessionRepository cashSessionRepository;
    private final TimeRecordRepository timeRecordRepository;
    private final UserRepository userRepository;
    private final SaleRepository saleRepository;
    private final ReturnRepository returnRepository;
    private final CreditTransactionRepository creditTransactionRepository;
    private final BranchRepository branchRepository;
    private final BranchAccessGuard branchAccessGuard;

    /**
     * Cashier starts their shift: clocks in and records the starting cash drawer
     * amount in one atomic step. Rejected if the user already has an open cash
     * session.
     */
    @Transactional
    public CashSessionResponse startShift(UUID userId, StartShiftRequest request) {
        if (cashSessionRepository.findActiveByUserId(userId).isPresent()) {
            throw new BusinessException("A cash session is already open for this user");
        }

        UserEntity user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found: " + userId));

        // Reuse the user's open TimeRecord (e.g. they clocked in via the time
        // clock first), but only if it isn't already tied to a cash session —
        // cash_sessions.time_record_id is UNIQUE, so reusing one that already has
        // a (possibly closed) session would violate the constraint. Otherwise
        // create a fresh record. Guards against orphaned/dangling time records.
        TimeRecord timeRecord = timeRecordRepository.findActiveRecordByUserId(userId)
                .filter(tr -> !cashSessionRepository.existsByTimeRecordId(tr.getId()))
                .orElseGet(() -> {
                    TimeRecord tr = new TimeRecord();
                    tr.setUser(user);
                    tr.setTenantId(user.getTenantId());
                    tr.setClockInTime(LocalDateTime.now());
                    return timeRecordRepository.save(tr);
                });

        // Resolve the branch this drawer opens at: explicit > user's primary > tenant default.
        BranchEntity branch;
        if (request.getBranchId() != null) {
            branch = branchRepository.findByIdAndTenantId(request.getBranchId(), user.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Branch not found: " + request.getBranchId()));
        } else if (user.getPrimaryBranch() != null) {
            branch = user.getPrimaryBranch();
        } else {
            branch = branchRepository.findByIsDefaultTrueAndTenantId(user.getTenantId())
                    .orElseThrow(() -> new BusinessException("No branch available to open a drawer"));
        }
        branchAccessGuard.assertCanAccess(branch.getId());

        CashSessionEntity session = new CashSessionEntity();
        session.setTenantId(user.getTenantId());
        session.setTimeRecord(timeRecord);
        session.setUserId(userId);
        session.setBranch(branch);
        session.setOpeningBalance(request.getOpeningBalance());
        session.setStatus(CashSessionEntity.Status.OPEN);
        session.setOpenedAt(LocalDateTime.now());
        session.setNotes(request.getNotes());

        return mapToResponse(cashSessionRepository.save(session), user, BigDecimal.ZERO, BigDecimal.ZERO,
                BigDecimal.ZERO);
    }

    /**
     * Cashier ends their shift: counts the drawer, records the closing balance,
     * system computes expected = opening + cash sales and stores the variance
     * (closing - expected). Also clocks the user out.
     */
    @Transactional
    public CashSessionResponse endShift(UUID userId, EndShiftRequest request) {
        CashSessionEntity session = cashSessionRepository.findActiveByUserId(userId)
                .orElseThrow(() -> new BusinessException("No open cash session found for this user"));

        BigDecimal cashSales = saleRepository.sumCashSalesBySessionId(session.getId());
        if (cashSales == null) cashSales = BigDecimal.ZERO;

        BigDecimal cashRefunds = getCashRefunds(session.getTenantId(), session.getOpenedAt(), LocalDateTime.now());
        BigDecimal cashRepayments = getCashRepayments(session.getId());

        BigDecimal expected = session.getOpeningBalance().add(cashSales).add(cashRepayments).subtract(cashRefunds);
        BigDecimal variance = request.getClosingBalance().subtract(expected);

        session.setClosingBalance(request.getClosingBalance());
        session.setExpectedBalance(expected);
        session.setVariance(variance);
        session.setStatus(CashSessionEntity.Status.CLOSED);
        session.setClosedAt(LocalDateTime.now());
        if (request.getNotes() != null && !request.getNotes().isBlank()) {
            // Append closing notes to any opening notes so we don't lose context.
            String existing = session.getNotes();
            session.setNotes((existing == null || existing.isBlank() ? "" : existing + "\n") + request.getNotes());
        }

        // Close the TimeRecord too (clock-out is part of ending the shift).
        TimeRecord timeRecord = session.getTimeRecord();
        if (timeRecord.getClockOutTime() == null) {
            timeRecord.setClockOutTime(LocalDateTime.now());
            timeRecordRepository.save(timeRecord);
        }

        CashSessionEntity saved = cashSessionRepository.save(session);
        UserEntity user = userRepository.findById(userId).orElse(null);
        return mapToResponse(saved, user, cashSales, cashRefunds, cashRepayments);
    }

    /**
     * Stale-session guard, invoked on logout. If the user walked away without
     * counting the drawer (e.g. an admin who has no End Shift control, or anyone
     * who just closed the tab), an OPEN session would otherwise live forever and
     * silently suppress the Start Shift prompt on the next login.
     *
     * Runs in its own transaction so a failure here can never roll back or block
     * the logout itself. The drawer is NOT counted: we record the system-expected
     * balance for reporting but leave closingBalance/variance null to flag that
     * this shift was auto-closed rather than reconciled.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void autoCloseOnLogout(UUID userId) {
        cashSessionRepository.findActiveByUserId(userId).ifPresent(session -> {
            BigDecimal cashSales = saleRepository.sumCashSalesBySessionId(session.getId());
            if (cashSales == null) cashSales = BigDecimal.ZERO;

            BigDecimal cashRefunds = getCashRefunds(session.getTenantId(), session.getOpenedAt(), LocalDateTime.now());
            BigDecimal cashRepayments = getCashRepayments(session.getId());
            BigDecimal expected = session.getOpeningBalance().add(cashSales).add(cashRepayments).subtract(cashRefunds);

            session.setExpectedBalance(expected);
            session.setStatus(CashSessionEntity.Status.CLOSED);
            session.setClosedAt(LocalDateTime.now());

            String note = "Auto-closed on logout (drawer not counted).";
            String existing = session.getNotes();
            session.setNotes((existing == null || existing.isBlank() ? "" : existing + "\n") + note);

            // Clock the user out too, mirroring endShift().
            TimeRecord timeRecord = session.getTimeRecord();
            if (timeRecord != null && timeRecord.getClockOutTime() == null) {
                timeRecord.setClockOutTime(LocalDateTime.now());
                timeRecordRepository.save(timeRecord);
            }

            cashSessionRepository.save(session);
            log.info("Auto-closed open cash session {} for user {} on logout", session.getId(), userId);
        });
    }

    @Transactional(readOnly = true)
    public CashSessionResponse getActiveForUser(UUID userId) {
        Optional<CashSessionEntity> active = cashSessionRepository.findActiveByUserId(userId);
        if (active.isEmpty()) return null;

        CashSessionEntity session = active.get();
        BigDecimal cashSales = saleRepository.sumCashSalesBySessionId(session.getId());
        if (cashSales == null) cashSales = BigDecimal.ZERO;

        BigDecimal cashRefunds = getCashRefunds(session.getTenantId(), session.getOpenedAt(), LocalDateTime.now());
        BigDecimal cashRepayments = getCashRepayments(session.getId());

        UserEntity user = userRepository.findById(userId).orElse(null);
        return mapToResponse(session, user, cashSales, cashRefunds, cashRepayments);
    }

    /**
     * Used by SaleService to tag a new sale with the current user's open session,
     * if any. Returns the entity (not a DTO) so the caller can set the FK directly.
     */
    @Transactional(readOnly = true)
    public Optional<CashSessionEntity> findActiveEntityByUserId(UUID userId) {
        return cashSessionRepository.findActiveByUserId(userId);
    }

    private BigDecimal getCashRefunds(UUID tenantId, LocalDateTime from, LocalDateTime to) {
        BigDecimal v = returnRepository.sumCashRefundsBetween(tenantId, from, to);
        return v != null ? v : BigDecimal.ZERO;
    }

    /** Cash taken in as store-credit repayments during this drawer session. */
    private BigDecimal getCashRepayments(UUID sessionId) {
        BigDecimal v = creditTransactionRepository.sumCashRepaymentsBySessionId(sessionId);
        return v != null ? v : BigDecimal.ZERO;
    }

    private CashSessionResponse mapToResponse(CashSessionEntity session, UserEntity user,
                                              BigDecimal cashSales, BigDecimal cashRefunds,
                                              BigDecimal cashRepayments) {
        return CashSessionResponse.builder()
                .id(session.getId())
                .userId(session.getUserId())
                .userName(user != null ? user.getFirstName() + " " + user.getLastName() : null)
                .branchId(session.getBranch() != null ? session.getBranch().getId() : null)
                .branchName(session.getBranch() != null ? session.getBranch().getName() : null)
                .timeRecordId(session.getTimeRecord() != null ? session.getTimeRecord().getId() : null)
                .clockInTime(session.getTimeRecord() != null ? session.getTimeRecord().getClockInTime() : null)
                .clockOutTime(session.getTimeRecord() != null ? session.getTimeRecord().getClockOutTime() : null)
                .openingBalance(session.getOpeningBalance())
                .closingBalance(session.getClosingBalance())
                .expectedBalance(session.getExpectedBalance())
                .cashSalesTotal(cashSales)
                .cashRefundsTotal(cashRefunds)
                .cashRepaymentsTotal(cashRepayments)
                .variance(session.getVariance())
                .status(session.getStatus().name())
                .openedAt(session.getOpenedAt())
                .closedAt(session.getClosedAt())
                .notes(session.getNotes())
                .build();
    }
}

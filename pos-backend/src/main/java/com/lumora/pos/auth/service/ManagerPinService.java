package com.lumora.pos.auth.service;

import com.lumora.pos.auth.entity.RoleEntity;
import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * "A manager has to OK this": checks a typed PIN against the tenant's managers.
 *
 * <p>Shared by payment correction ({@code SaleService}) and restaurant voids, so
 * there is one constant-time loop, not two drifting copies. It returns WHO
 * approved, so the audit record names the manager, not just "a PIN was typed".
 */
@Service
@RequiredArgsConstructor
public class ManagerPinService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    /** The active MANAGER or ADMIN whose PIN this is, if any. */
    public Optional<UserEntity> findApprover(UUID tenantId, String pin) {
        if (pin == null || pin.isBlank()) {
            return Optional.empty();
        }
        return match(userRepository.findActiveUsersWithPinByTenantId(tenantId), pin, passwordEncoder);
    }

    /**
     * Walks every candidate without stopping at the first match, so the time
     * taken says nothing about which (if any) PIN matched — the same pattern as
     * {@code AuthService.pinLogin}.
     */
    public static Optional<UserEntity> match(List<UserEntity> candidates, String pin, PasswordEncoder encoder) {
        UserEntity approver = null;
        for (UserEntity user : candidates) {
            boolean pinMatches = encoder.matches(pin, user.getPin());
            boolean isManager = user.getRoles().stream()
                    .map(RoleEntity::getName)
                    .anyMatch(n -> "MANAGER".equalsIgnoreCase(n) || "ADMIN".equalsIgnoreCase(n));
            if (pinMatches && isManager && approver == null) {
                approver = user;
            }
        }
        return Optional.ofNullable(approver);
    }

    /** Whether the signed-in user is a manager themselves — they approve their own. */
    public boolean currentUserIsManager() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) {
            return false;
        }
        for (GrantedAuthority authority : auth.getAuthorities()) {
            String a = authority.getAuthority();
            if ("ROLE_MANAGER".equals(a) || "ROLE_ADMIN".equals(a)) {
                return true;
            }
        }
        return false;
    }
}

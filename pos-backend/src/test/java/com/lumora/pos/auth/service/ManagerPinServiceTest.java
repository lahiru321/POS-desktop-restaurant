package com.lumora.pos.auth.service;

import com.lumora.pos.auth.entity.RoleEntity;
import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("ManagerPinService Unit Tests")
class ManagerPinServiceTest {

    @Mock private UserRepository userRepository;
    @Mock private PasswordEncoder passwordEncoder;

    @InjectMocks private ManagerPinService managerPinService;

    private final UUID tenantId = UUID.randomUUID();

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("Returns the manager whose PIN it is")
    void shouldFindManager() {
        UserEntity cashier = user("CASHIER", "hash-c");
        UserEntity manager = user("MANAGER", "hash-m");
        when(userRepository.findActiveUsersWithPinByTenantId(tenantId)).thenReturn(List.of(cashier, manager));
        when(passwordEncoder.matches("4321", "hash-c")).thenReturn(false);
        when(passwordEncoder.matches("4321", "hash-m")).thenReturn(true);

        assertThat(managerPinService.findApprover(tenantId, "4321")).contains(manager);
    }

    @Test
    @DisplayName("A cashier's own PIN approves nothing")
    void shouldRefuseCashierPin() {
        UserEntity cashier = user("CASHIER", "hash-c");
        when(userRepository.findActiveUsersWithPinByTenantId(tenantId)).thenReturn(List.of(cashier));
        when(passwordEncoder.matches("1111", "hash-c")).thenReturn(true);

        assertThat(managerPinService.findApprover(tenantId, "1111")).isEmpty();
    }

    @Test
    @DisplayName("Checks every candidate even after a match — constant time")
    void shouldCheckEveryCandidate() {
        UserEntity first = user("ADMIN", "hash-a");
        UserEntity second = user("MANAGER", "hash-b");
        when(userRepository.findActiveUsersWithPinByTenantId(tenantId)).thenReturn(List.of(first, second));
        when(passwordEncoder.matches(anyString(), any())).thenReturn(true);

        assertThat(managerPinService.findApprover(tenantId, "0000")).contains(first);
        verify(passwordEncoder, times(2)).matches(anyString(), any());
    }

    @Test
    @DisplayName("A blank PIN never reaches the database")
    void shouldIgnoreBlankPin() {
        assertThat(managerPinService.findApprover(tenantId, " ")).isEmpty();
        verifyNoInteractions(userRepository);
    }

    @Test
    @DisplayName("Knows a signed-in manager or admin from a cashier")
    void shouldReadCurrentRole() {
        signIn("ROLE_CASHIER");
        assertThat(managerPinService.currentUserIsManager()).isFalse();
        signIn("ROLE_MANAGER");
        assertThat(managerPinService.currentUserIsManager()).isTrue();
        signIn("ROLE_ADMIN");
        assertThat(managerPinService.currentUserIsManager()).isTrue();
    }

    private void signIn(String role) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                UUID.randomUUID().toString(), null, List.of(new SimpleGrantedAuthority(role))));
    }

    private UserEntity user(String role, String hashedPin) {
        UserEntity u = UserEntity.builder()
                .email(role.toLowerCase() + "@test").passwordHash("x")
                .firstName(role).lastName("User").pin(hashedPin)
                .roles(Set.of(RoleEntity.builder().name(role).build()))
                .build();
        u.setId(UUID.randomUUID());
        return u;
    }
}

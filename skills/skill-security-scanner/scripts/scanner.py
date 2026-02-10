import subprocess
import json
import requests
from pathlib import Path
from typing import Dict, List, Any
from dataclasses import dataclass
from datetime import datetime

@dataclass
class Vulnerability:
    package: str
    version: str
    vulnerability_id: str
    severity: str
    cve: List[str]
    cvss_score: float
    fixed_versions: List[str]
    source: str

class DependencyScanner:
    def __init__(self, project_path: str):
        self.project_path = Path(project_path)
        self.ecosystem_scanners = {
            'npm': self.scan_npm,
            'pip': self.scan_python,
            'go': self.scan_go,
            'cargo': self.scan_rust
        }

    def detect_ecosystems(self) -> List[str]:
        ecosystem_files = {
            'npm': ['package.json', 'package-lock.json'],
            'pip': ['requirements.txt', 'pyproject.toml'],
            'go': ['go.mod'],
            'cargo': ['Cargo.toml']
        }

        detected = []
        for ecosystem, patterns in ecosystem_files.items():
            if any(list(self.project_path.glob(f"**/{p}")) for p in patterns):
                detected.append(ecosystem)
        return detected

    def scan_all_dependencies(self) -> Dict[str, Any]:
        ecosystems = self.detect_ecosystems()
        results = {
            'timestamp': datetime.now().isoformat(),
            'ecosystems': {},
            'vulnerabilities': [],
            'summary': {
                'total_vulnerabilities': 0,
                'critical': 0,
                'high': 0,
                'medium': 0,
                'low': 0
            }
        }

        for ecosystem in ecosystems:
            scanner = self.ecosystem_scanners.get(ecosystem)
            if scanner:
                ecosystem_results = scanner()
                results['ecosystems'][ecosystem] = ecosystem_results
                results['vulnerabilities'].extend(ecosystem_results.get('vulnerabilities', []))

        self._update_summary(results)
        results['remediation_plan'] = self.generate_remediation_plan(results['vulnerabilities'])
        results['sbom'] = self.generate_sbom(results['ecosystems'])

        return results

    def scan_npm(self) -> Dict[str, Any]:
        results = {
            'ecosystem': 'npm',
            'vulnerabilities': []
        }

        try:
            npm_result = subprocess.run(
                ['npm', 'audit', '--json'],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                timeout=120,
                shell=True
            )

            if npm_result.stdout:
                audit_data = json.loads(npm_result.stdout)
                for vuln_id, vuln in audit_data.get('vulnerabilities', {}).items():
                    results['vulnerabilities'].append({
                        'package': vuln.get('name', vuln_id),
                        'version': vuln.get('range', ''),
                        'vulnerability_id': vuln_id,
                        'severity': vuln.get('severity', 'UNKNOWN').upper(),
                        'cve': vuln.get('via', []), # adjusted for npm 7+ structure if needed
                        'fixed_in': vuln.get('fixAvailable', {}).get('version', 'N/A') if isinstance(vuln.get('fixAvailable'), dict) else 'N/A',
                        'source': 'npm_audit'
                    })
        except Exception as e:
            results['error'] = str(e)

        return results

    def scan_python(self) -> Dict[str, Any]:
        results = {
            'ecosystem': 'python',
            'vulnerabilities': []
        }

        try:
            safety_result = subprocess.run(
                ['safety', 'check', '--json'],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                timeout=120,
                shell=True
            )

            if safety_result.stdout:
                safety_data = json.loads(safety_result.stdout)
                for vuln in safety_data:
                    results['vulnerabilities'].append({
                        'package': vuln.get('package_name', ''),
                        'version': vuln.get('analyzed_version', ''),
                        'vulnerability_id': vuln.get('vulnerability_id', ''),
                        'severity': 'HIGH',
                        'fixed_in': vuln.get('fixed_version', ''),
                        'source': 'safety'
                    })
        except Exception as e:
            results['error'] = str(e)

        return results

    def scan_go(self) -> Dict[str, Any]:
        results = {
            'ecosystem': 'go',
            'vulnerabilities': []
        }

        try:
            govuln_result = subprocess.run(
                ['govulncheck', '-json', './...'],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                timeout=180,
                shell=True
            )

            if govuln_result.stdout:
                for line in govuln_result.stdout.strip().split('\n'):
                    if line:
                        vuln_data = json.loads(line)
                        if vuln_data.get('finding'):
                            finding = vuln_data['finding']
                            results['vulnerabilities'].append({
                                'package': finding.get('osv', ''),
                                'vulnerability_id': finding.get('osv', ''),
                                'severity': 'HIGH',
                                'source': 'govulncheck'
                            })
        except Exception as e:
            results['error'] = str(e)

        return results

    def scan_rust(self) -> Dict[str, Any]:
        results = {
            'ecosystem': 'rust',
            'vulnerabilities': []
        }

        try:
            audit_result = subprocess.run(
                ['cargo', 'audit', '--json'],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                timeout=120,
                shell=True
            )

            if audit_result.stdout:
                audit_data = json.loads(audit_result.stdout)
                for vuln in audit_data.get('vulnerabilities', {}).get('list', []):
                    advisory = vuln.get('advisory', {})
                    results['vulnerabilities'].append({
                        'package': vuln.get('package', {}).get('name', ''),
                        'version': vuln.get('package', {}).get('version', ''),
                        'vulnerability_id': advisory.get('id', ''),
                        'severity': 'HIGH',
                        'source': 'cargo_audit'
                    })
        except Exception as e:
            results['error'] = str(e)

        return results

    def _update_summary(self, results: Dict[str, Any]):
        vulnerabilities = results['vulnerabilities']
        results['summary']['total_vulnerabilities'] = len(vulnerabilities)

        for vuln in vulnerabilities:
            severity = vuln.get('severity', '').upper()
            if severity == 'CRITICAL':
                results['summary']['critical'] += 1
            elif severity == 'HIGH':
                results['summary']['high'] += 1
            elif severity == 'MEDIUM':
                results['summary']['medium'] += 1
            elif severity == 'LOW':
                results['summary']['low'] += 1

    def generate_remediation_plan(self, vulnerabilities: List[Dict]) -> Dict[str, Any]:
        plan = {
            'immediate_actions': [],
            'short_term': [],
            'automation_scripts': {}
        }

        critical_high = [v for v in vulnerabilities if v.get('severity', '').upper() in ['CRITICAL', 'HIGH']]

        for vuln in critical_high[:20]:
            plan['immediate_actions'].append({
                'package': vuln.get('package', ''),
                'current_version': vuln.get('version', ''),
                'fixed_version': vuln.get('fixed_in', 'latest'),
                'severity': vuln.get('severity', ''),
                'priority': 1
            })

        plan['automation_scripts'] = {
            'npm_fix': 'npm audit fix && npm update',
            'pip_fix': 'pip-audit --fix && safety check',
            'go_fix': 'go get -u ./... && go mod tidy',
            'cargo_fix': 'cargo update && cargo audit'
        }

        return plan

    def generate_sbom(self, ecosystems: Dict[str, Any]) -> Dict[str, Any]:
        sbom = {
            'bomFormat': 'CycloneDX',
            'specVersion': '1.5',
            'version': 1,
            'metadata': {
                'timestamp': datetime.now().isoformat()
            },
            'components': []
        }

        for ecosystem_name, ecosystem_data in ecosystems.items():
            for vuln in ecosystem_data.get('vulnerabilities', []):
                sbom['components'].append({
                    'type': 'library',
                    'name': vuln.get('package', ''),
                    'version': vuln.get('version', ''),
                    'purl': f"pkg:{ecosystem_name}/{vuln.get('package', '')}@{vuln.get('version', '')}"
                })

        return sbom

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Dependency Scanner')
    parser.add_argument('--path', type=str, default='.', help='Project path to scan')
    args = parser.parse_args()
    
    scanner = DependencyScanner(args.path)
    results = scanner.scan_all_dependencies()
    print(json.dumps(results, indent=2))
